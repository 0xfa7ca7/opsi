import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXIT_CODES, OpsiError, type Provenance } from "@opsi/domain";
import { exportStage } from "./export.js";
import { sqlIdentifier, sqlString } from "./sql-path.js";
import { isStringColumn, stageTabularInput, type TabularStage } from "./tabular-stage.js";
import type {
  ConversionOptions,
  ConversionResult,
  DataEngineOptions,
  SupportedDataFormat,
  ValidationIssue,
} from "./types.js";

async function digest(path: string): Promise<{ readonly sha256: string; readonly bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const raw of createReadStream(path)) {
    const chunk = Buffer.from(raw as Uint8Array);
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Opening directories is not supported on every Node platform.
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertPublishable(path: string, force: boolean): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink())
      throw new OpsiError({
        code: "UNSAFE_CONVERSION_DESTINATION",
        message: "The conversion destination is not a regular file.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { path },
      });
    if (!force)
      throw new OpsiError({
        code: "CONVERSION_DESTINATION_EXISTS",
        message: "The conversion destination already exists.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        suggestion: "Use --force to replace the existing regular file.",
        context: { path },
      });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function selectSql(stage: TabularStage, spreadsheetSafe: boolean): string {
  const quote = sqlString("'");
  const projections = stage.columns.map((column) => {
    const name = sqlIdentifier(column.name);
    if (!spreadsheetSafe || !isStringColumn(column.typeId)) return name;
    return `CASE WHEN regexp_matches(coalesce(${name}, ''), '^[=+@-]') THEN ${quote} || ${name} ELSE ${name} END AS ${name}`;
  });
  return `SELECT ${projections.join(", ")} FROM data`;
}

async function spreadsheetRisks(stage: TabularStage): Promise<number> {
  const predicates = stage.columns
    .filter((column) => isStringColumn(column.typeId))
    .map((column) => `regexp_matches(coalesce(${sqlIdentifier(column.name)}, ''), '^[=+@-]')`);
  if (predicates.length === 0) return 0;
  const reader = await stage.connection.runAndReadAll(
    `SELECT coalesce(sum(${predicates.map((predicate) => `CAST(${predicate} AS BIGINT)`).join(" + ")}), 0) AS count FROM data`,
  );
  const value = reader.getRowObjectsJS()[0]?.count;
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

async function writeProvenanceTemp(
  path: string,
  value: Provenance & { readonly bytes: number },
): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publish(temp: string, destination: string, force: boolean): Promise<void> {
  if (force) {
    await rename(temp, destination);
    return;
  }
  try {
    await link(temp, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new OpsiError({
        code: "CONVERSION_DESTINATION_EXISTS",
        message: "The conversion destination already exists.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        suggestion: "Use --force to replace the existing regular file.",
        context: { path: destination },
      });
    throw error;
  }
}

export async function convertData(
  options: ConversionOptions,
  engineOptions: DataEngineOptions,
  xlsxSharedStringsByteLimit: number,
): Promise<ConversionResult> {
  const output = resolve(options.output);
  const directory = dirname(output);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const provenancePath = `${output}.provenance.json`;
  const outputExisted = await assertPublishable(output, options.force);
  const provenanceExisted = await assertPublishable(provenancePath, options.force);

  const token = `${process.pid}-${randomUUID()}`;
  const outputTemp = `${output}.part-${token}`;
  const provenanceTemp = `${provenancePath}.part-${token}`;
  const databasePath = `${output}.stage-${token}.duckdb`;
  const xlsxRowsPath = `${output}.stage-${token}.ndjson`;
  const outputBackup = `${output}.backup-${token}`;
  const provenanceBackup = `${provenancePath}.backup-${token}`;
  let stage: TabularStage | undefined;
  let publishedOutput = false;
  let publishedProvenance = false;
  try {
    stage = await stageTabularInput({
      input: options.input,
      ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
      databasePath,
      xlsxRowsPath,
      xlsxSharedStringsByteLimit,
    });
    if (resolve(stage.inputPath) === output)
      throw new OpsiError({
        code: "CONVERSION_INPUT_OUTPUT_CONFLICT",
        message: "Input and output must be different files.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    const riskCount = await spreadsheetRisks(stage);
    const spreadsheetSafe = options.spreadsheetSafe ?? false;
    const warnings: ValidationIssue[] = [...stage.warnings];
    if (riskCount > 0 && !spreadsheetSafe)
      warnings.push({
        code: "FORMULA_LIKE_VALUE",
        severity: "warning",
        message: `${riskCount} value(s) may be interpreted as spreadsheet formulas.`,
        recommendation: "Review the values or use --spreadsheet-safe to prefix them.",
        context: { count: riskCount },
      });

    await exportStage(stage, outputTemp, options.targetFormat, selectSql(stage, spreadsheetSafe));
    await syncFile(outputTemp);
    engineOptions.onAdapter?.(`convert-${options.targetFormat}`);
    const [inputDigest, outputDigest] = await Promise.all([
      digest(stage.inputPath),
      digest(outputTemp),
    ]);
    const timestamp = new Date().toISOString();
    const provenance: Provenance & { readonly bytes: number } = {
      schemaVersion: "1",
      retrievedAt: timestamp,
      sha256: outputDigest.sha256,
      localPath: output,
      mediaType: mediaType(options.targetFormat),
      bytes: outputDigest.bytes,
      transformations: [
        {
          operation: "convert",
          timestamp,
          inputSha256: inputDigest.sha256,
          details: {
            sourceFormat: stage.sourceFormat,
            targetFormat: options.targetFormat,
            spreadsheetSafe,
            spreadsheetSafeChanges: spreadsheetSafe ? riskCount : 0,
            ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
          },
        },
      ],
    };
    await writeProvenanceTemp(provenanceTemp, provenance);
    if (options.force) {
      if (outputExisted) await link(output, outputBackup);
      if (provenanceExisted) await link(provenancePath, provenanceBackup);
    }
    await publish(outputTemp, output, options.force);
    publishedOutput = true;
    engineOptions.onAdapter?.("convert-output-published");
    await publish(provenanceTemp, provenancePath, options.force);
    publishedProvenance = true;
    await syncDirectory(directory);
    return {
      input: stage.inputPath,
      output,
      targetFormat: options.targetFormat,
      bytesWritten: outputDigest.bytes,
      provenance,
      provenancePath,
      warnings,
    };
  } catch (error) {
    if (publishedProvenance) {
      if (provenanceExisted) {
        await rename(provenanceBackup, provenancePath).catch(() => undefined);
      } else {
        await rm(provenancePath, { force: true }).catch(() => undefined);
      }
    }
    if (publishedOutput) {
      if (outputExisted) {
        await rename(outputBackup, output).catch(() => undefined);
      } else {
        await rm(output, { force: true }).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await stage?.close().catch(() => undefined);
    await Promise.all([
      rm(outputTemp, { force: true }),
      rm(provenanceTemp, { force: true }),
      rm(databasePath, { force: true }),
      rm(`${databasePath}.wal`, { force: true }),
      rm(xlsxRowsPath, { force: true }),
      rm(outputBackup, { force: true }),
      rm(provenanceBackup, { force: true }),
    ]);
  }
}

function mediaType(format: SupportedDataFormat): string {
  switch (format) {
    case "csv":
      return "text/csv";
    case "tsv":
      return "text/tab-separated-values";
    case "json":
      return "application/json";
    case "ndjson":
      return "application/x-ndjson";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "parquet":
      return "application/vnd.apache.parquet";
  }
}

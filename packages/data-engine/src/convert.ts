import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link as fsLink,
  lstat as fsLstat,
  mkdir as fsMkdir,
  open as fsOpen,
  rename as fsRename,
  rm as fsRm,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXIT_CODES, OpsiError, type Provenance } from "@opsi/domain";
import { exportStage } from "./export.js";
import { sqlIdentifier, sqlString } from "./sql-path.js";
import { isStringColumn, stageTabularInput, type TabularStage } from "./tabular-stage.js";
import type {
  ConversionOptions,
  ConversionResult,
  ConversionFileSystem,
  DataEngineOptions,
  SupportedDataFormat,
  ValidationIssue,
} from "./types.js";

const nodeFileSystem: ConversionFileSystem = {
  mkdir: (path, options) => fsMkdir(path, options),
  lstat: (path) => fsLstat(path),
  open: (path, flags, mode) => fsOpen(path, flags, mode),
  link: (existingPath, newPath) => fsLink(existingPath, newPath),
  rename: (oldPath, newPath) => fsRename(oldPath, newPath),
  rm: (path, options) => fsRm(path, options),
};

function conversionFileSystem(options: DataEngineOptions): ConversionFileSystem {
  return { ...nodeFileSystem, ...options.conversionFileSystem };
}

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

function unsupportedDirectorySync(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EINVAL" || code === "ENOTSUP" || code === "ENOSYS") return true;
  return process.platform === "win32" && (code === "EISDIR" || code === "EPERM");
}

async function syncDirectory(fileSystem: ConversionFileSystem, path: string): Promise<void> {
  try {
    const handle = await fileSystem.open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!unsupportedDirectorySync(error)) throw error;
  }
}

async function syncFile(fileSystem: ConversionFileSystem, path: string): Promise<void> {
  const handle = await fileSystem.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertPublishable(
  fileSystem: ConversionFileSystem,
  path: string,
  force: boolean,
): Promise<boolean> {
  try {
    const details = await fileSystem.lstat(path);
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
  fileSystem: ConversionFileSystem,
  path: string,
  value: Provenance & { readonly bytes: number },
): Promise<void> {
  const handle = await fileSystem.open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publish(
  fileSystem: ConversionFileSystem,
  temp: string,
  destination: string,
  force: boolean,
): Promise<void> {
  if (force) {
    await fileSystem.rename(temp, destination);
    return;
  }
  try {
    await fileSystem.link(temp, destination);
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

interface PublicationState {
  readonly label: "output" | "provenance";
  readonly original: string;
  readonly backup: string;
  readonly restoreLink: string;
  readonly existed: boolean;
  backedUp: boolean;
  published: boolean;
  restored: boolean;
}

interface RollbackFailure {
  readonly label: string;
  readonly original: string;
  readonly backup: string;
  readonly restoreLink: string;
  readonly code?: string;
  readonly message: string;
  readonly cause: unknown;
}

function rollbackFailure(
  state: PublicationState,
  cause: unknown,
  label: string = state.label,
): RollbackFailure {
  const code = (cause as NodeJS.ErrnoException).code;
  return {
    label,
    original: state.original,
    backup: state.backup,
    restoreLink: state.restoreLink,
    ...(code === undefined ? {} : { code }),
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

function publicationContext(state: PublicationState): Readonly<Record<string, unknown>> {
  return {
    original: state.original,
    backup: state.backup,
    restoreLink: state.restoreLink,
    existed: state.existed,
    published: state.published,
    restored: state.restored,
  };
}

async function restorePublication(
  fileSystem: ConversionFileSystem,
  directory: string,
  state: PublicationState,
): Promise<void> {
  if (!state.published) {
    state.restored = true;
    return;
  }
  if (state.existed) {
    await fileSystem.link(state.backup, state.restoreLink);
    await fileSystem.rename(state.restoreLink, state.original);
    await syncFile(fileSystem, state.original);
  } else {
    await fileSystem.rm(state.original, { force: true });
  }
  await syncDirectory(fileSystem, directory);
  state.restored = true;
}

async function rollbackPublications(
  fileSystem: ConversionFileSystem,
  directory: string,
  output: PublicationState,
  provenance: PublicationState,
  operationError: unknown,
): Promise<void> {
  const failures: RollbackFailure[] = [];
  for (const state of [output, provenance]) {
    try {
      await restorePublication(fileSystem, directory, state);
    } catch (error) {
      failures.push(rollbackFailure(state, error));
    }
  }

  if (failures.length === 0) {
    try {
      if (output.backedUp) await fileSystem.rm(output.backup, { force: true });
      if (provenance.backedUp) await fileSystem.rm(provenance.backup, { force: true });
      if (output.backedUp || provenance.backedUp) await syncDirectory(fileSystem, directory);
    } catch (error) {
      failures.push(rollbackFailure(output, error, "backup-cleanup"));
    }
  }

  if (failures.length > 0)
    throw new OpsiError({
      code: "CONVERSION_ROLLBACK_FAILED",
      message: "Conversion failed and the previous output pair could not be fully restored.",
      exitCode: EXIT_CODES.INTEGRITY_FAILURE,
      suggestion: "Recover the original artifact and provenance from the retained backup paths.",
      context: {
        output: publicationContext(output),
        provenance: publicationContext(provenance),
        failures: failures.map((failure) => ({
          label: failure.label,
          original: failure.original,
          backup: failure.backup,
          restoreLink: failure.restoreLink,
          ...(failure.code === undefined ? {} : { code: failure.code }),
          message: failure.message,
        })),
      },
      cause: new AggregateError(
        [operationError, ...failures.map((failure) => failure.cause)],
        "Conversion operation and rollback failures",
      ),
    });
}

interface CleanupFailure {
  readonly phase: "stage-close" | "remove" | "backup-remove" | "backup-directory-sync";
  readonly path?: string;
  readonly paths?: readonly string[];
  readonly code?: string;
  readonly message: string;
  readonly cause: unknown;
}

function cleanupFailure(
  phase: CleanupFailure["phase"],
  cause: unknown,
  location: { readonly path: string } | { readonly paths: readonly string[] },
): CleanupFailure {
  const code = (cause as NodeJS.ErrnoException).code;
  return {
    phase,
    ...location,
    ...(code === undefined ? {} : { code }),
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

function cleanupFailureContext(failure: CleanupFailure): Readonly<Record<string, unknown>> {
  return {
    phase: failure.phase,
    ...(failure.path === undefined ? {} : { path: failure.path }),
    ...(failure.paths === undefined ? {} : { paths: failure.paths }),
    ...(failure.code === undefined ? {} : { code: failure.code }),
    message: failure.message,
  };
}

function primaryFailureContext(error: unknown): Readonly<Record<string, unknown>> {
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    ...((error as NodeJS.ErrnoException).code === undefined
      ? {}
      : { code: (error as NodeJS.ErrnoException).code }),
  };
}

function withCleanupFailures(primary: unknown, failures: readonly CleanupFailure[]): OpsiError {
  const cleanupFailures = failures.map(cleanupFailureContext);
  const cause = new AggregateError(
    [...(primary === undefined ? [] : [primary]), ...failures.map((failure) => failure.cause)],
    "Conversion operation and cleanup failures",
  );
  if (primary instanceof OpsiError)
    return new OpsiError({
      code: primary.code,
      message: primary.message,
      exitCode: primary.exitCode,
      ...(primary.suggestion === undefined ? {} : { suggestion: primary.suggestion }),
      context: { ...(primary.context ?? {}), cleanupFailures },
      cause,
    });
  return new OpsiError({
    code: "CONVERSION_CLEANUP_FAILED",
    message:
      primary === undefined
        ? "Conversion output was published, but temporary resources could not be cleaned up."
        : "Conversion failed and its temporary resources could not be cleaned up.",
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    suggestion: "Remove the listed temporary paths after confirming they are not recovery backups.",
    context: {
      ...(primary === undefined ? {} : { primary: primaryFailureContext(primary) }),
      cleanupFailures,
    },
    cause,
  });
}

async function cleanupConversion(
  fileSystem: ConversionFileSystem,
  engineOptions: DataEngineOptions,
  stage: TabularStage | undefined,
  committed: boolean,
  directory: string,
  publications: readonly PublicationState[],
  paths: {
    readonly outputTemp: string;
    readonly provenanceTemp: string;
    readonly databasePath: string;
    readonly xlsxRowsPath: string;
  },
): Promise<readonly CleanupFailure[]> {
  const failures: CleanupFailure[] = [];
  const backupPaths = publications
    .filter((publication) => publication.backedUp)
    .map((publication) => publication.backup);
  if (committed && backupPaths.length > 0) {
    for (const path of backupPaths)
      try {
        await fileSystem.rm(path, { force: true });
      } catch (error) {
        failures.push(cleanupFailure("backup-remove", error, { path }));
      }
    try {
      await syncDirectory(fileSystem, directory);
    } catch (error) {
      failures.push(
        cleanupFailure("backup-directory-sync", error, {
          paths: [directory, ...backupPaths],
        }),
      );
    }
  }

  const stagePaths = [paths.databasePath, `${paths.databasePath}.wal`, paths.xlsxRowsPath];
  if (stage !== undefined)
    try {
      const close = () => stage.close();
      if (engineOptions.conversionStageClose === undefined) await close();
      else await engineOptions.conversionStageClose(close);
    } catch (error) {
      failures.push(cleanupFailure("stage-close", error, { paths: stagePaths }));
    }

  const removalPaths = [
    paths.outputTemp,
    paths.provenanceTemp,
    paths.databasePath,
    `${paths.databasePath}.wal`,
    paths.xlsxRowsPath,
  ];
  await Promise.all(
    removalPaths.map(async (path) => {
      try {
        await fileSystem.rm(path, { force: true });
      } catch (error) {
        failures.push(cleanupFailure("remove", error, { path }));
      }
    }),
  );
  return failures;
}

export async function convertData(
  options: ConversionOptions,
  engineOptions: DataEngineOptions,
  xlsxSharedStringsByteLimit: number,
): Promise<ConversionResult> {
  const fileSystem = conversionFileSystem(engineOptions);
  const output = resolve(options.output);
  const directory = dirname(output);
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  const provenancePath = `${output}.provenance.json`;
  const outputExisted = await assertPublishable(fileSystem, output, options.force);
  const provenanceExisted = await assertPublishable(fileSystem, provenancePath, options.force);

  const token = `${process.pid}-${randomUUID()}`;
  const outputTemp = `${output}.part-${token}`;
  const provenanceTemp = `${provenancePath}.part-${token}`;
  const databasePath = `${output}.stage-${token}.duckdb`;
  const xlsxRowsPath = `${output}.stage-${token}.ndjson`;
  const outputBackup = `${output}.backup-${token}`;
  const provenanceBackup = `${provenancePath}.backup-${token}`;
  const outputPublication: PublicationState = {
    label: "output",
    original: output,
    backup: outputBackup,
    restoreLink: `${output}.restore-${token}`,
    existed: outputExisted,
    backedUp: false,
    published: false,
    restored: false,
  };
  const provenancePublication: PublicationState = {
    label: "provenance",
    original: provenancePath,
    backup: provenanceBackup,
    restoreLink: `${provenancePath}.restore-${token}`,
    existed: provenanceExisted,
    backedUp: false,
    published: false,
    restored: false,
  };
  let stage: TabularStage | undefined;
  let committed = false;
  let result: ConversionResult | undefined;
  let primaryError: unknown;
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
    await syncFile(fileSystem, outputTemp);
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
    await writeProvenanceTemp(fileSystem, provenanceTemp, provenance);
    if (options.force) {
      if (outputExisted) {
        await fileSystem.link(output, outputBackup);
        outputPublication.backedUp = true;
        await syncFile(fileSystem, outputBackup);
      }
      if (provenanceExisted) {
        await fileSystem.link(provenancePath, provenanceBackup);
        provenancePublication.backedUp = true;
        await syncFile(fileSystem, provenanceBackup);
      }
      if (outputExisted || provenanceExisted) await syncDirectory(fileSystem, directory);
    }
    await publish(fileSystem, outputTemp, output, options.force);
    outputPublication.published = true;
    await syncFile(fileSystem, output);
    await syncDirectory(fileSystem, directory);
    engineOptions.onAdapter?.("convert-output-published");
    await publish(fileSystem, provenanceTemp, provenancePath, options.force);
    provenancePublication.published = true;
    await syncFile(fileSystem, provenancePath);
    await syncDirectory(fileSystem, directory);
    engineOptions.onAdapter?.("convert-provenance-published");
    committed = true;
    result = {
      input: stage.inputPath,
      output,
      targetFormat: options.targetFormat,
      bytesWritten: outputDigest.bytes,
      provenance,
      provenancePath,
      warnings,
    };
  } catch (error) {
    primaryError = error;
    if (
      !committed &&
      (outputPublication.published ||
        provenancePublication.published ||
        outputPublication.backedUp ||
        provenancePublication.backedUp)
    )
      try {
        await rollbackPublications(
          fileSystem,
          directory,
          outputPublication,
          provenancePublication,
          error,
        );
      } catch (rollbackError) {
        primaryError = rollbackError;
      }
  }

  const cleanupFailures = await cleanupConversion(
    fileSystem,
    engineOptions,
    stage,
    committed,
    directory,
    [outputPublication, provenancePublication],
    {
      outputTemp,
      provenanceTemp,
      databasePath,
      xlsxRowsPath,
    },
  );
  if (cleanupFailures.length > 0) throw withCleanupFailures(primaryError, cleanupFailures);
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined)
    throw new OpsiError({
      code: "CONVERSION_RESULT_MISSING",
      message: "Conversion completed without a result.",
      exitCode: EXIT_CODES.INTERNAL,
    });
  return result;
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

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import { publishArtifactPair } from "@klopsi/storage";
import type { ChartType } from "./render.js";

export interface ChartTransformation {
  readonly rendererVersion: string;
  readonly type: ChartType;
  readonly x: string;
  readonly y: string;
  readonly title: string;
  readonly limit: number;
  readonly points: number;
  readonly truncated: boolean;
  readonly order: "source";
}

interface PublishChartCommon {
  readonly output: string;
  readonly html: string;
  readonly force: boolean;
  readonly transformation: ChartTransformation;
  readonly now?: () => Date;
}

export type PublishChartInput = PublishChartCommon &
  (
    | { readonly source: string; readonly sourceSha256?: never }
    | { readonly source?: never; readonly sourceSha256: string }
  );

export interface PublishedChart {
  readonly output: string;
  readonly provenancePath: string;
  readonly sha256: string;
  readonly bytes: number;
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

async function writeSynced(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishChart(input: PublishChartInput): Promise<PublishedChart> {
  const destination = resolve(input.output);
  if (extname(destination).toLowerCase() !== ".html")
    throw new KlopsiError({
      code: "CHART_OUTPUT_FORMAT",
      message: "Chart output must end in .html.",
      exitCode: EXIT_CODES.INVALID_INPUT,
    });

  const token = `${process.pid}-${randomUUID()}`;
  const artifactTemp = `${destination}.tmp-${token}`;
  const provenanceTemp = `${destination}.provenance.json.tmp-${token}`;
  try {
    await writeSynced(artifactTemp, input.html);
    const [inputSha256, outputDigest] = await Promise.all([
      input.sourceSha256 ?? digest(input.source).then((value) => value.sha256),
      digest(artifactTemp),
    ]);
    const timestamp = (input.now?.() ?? new Date()).toISOString();
    await writeSynced(
      provenanceTemp,
      `${JSON.stringify(
        {
          schemaVersion: "1",
          retrievedAt: timestamp,
          ...outputDigest,
          mediaType: "text/html",
          localPath: destination,
          transformations: [
            {
              operation: "chart",
              timestamp,
              inputSha256,
              details: input.transformation,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const published = await publishArtifactPair(artifactTemp, provenanceTemp, destination, {
      force: input.force,
      existsCode: "CHART_DESTINATION_EXISTS",
      existsExitCode: EXIT_CODES.INVALID_INPUT,
    });
    return { ...published, ...outputDigest };
  } catch (error) {
    await Promise.all([rm(artifactTemp, { force: true }), rm(provenanceTemp, { force: true })]);
    throw error;
  }
}

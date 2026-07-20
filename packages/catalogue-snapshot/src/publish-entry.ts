#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES, OpsiError, type DataProvider } from "@opsi/domain";
import { OpsiProvider, OpsiTransport, RequestScheduler } from "@opsi/provider-opsi";
import {
  CATALOGUE_MAX_MANIFEST_BYTES,
  CATALOGUE_MAX_SNAPSHOT_BYTES,
  CATALOGUE_SCHEMA_VERSION,
  parseCatalogueIndex,
  parseCatalogueSnapshot,
  type CatalogueIndex,
} from "./contracts.js";
import { generateCatalogueSnapshot } from "./generator.js";
import { assertSafeCount, buildPublication, retainedManifests } from "./publication.js";
import { StrictHttpsReader } from "./remote.js";
import { snapshotInvalid } from "./errors.js";

export interface PublisherRuntime {
  readonly now?: () => Date;
  readonly createProvider?: () => DataProvider;
  readonly createReader?: (baseUrl: string) => StrictHttpsReader;
  readonly writeStdout?: (value: string) => void;
}

interface PublisherArguments {
  readonly output: string;
  readonly previousBaseUrl: string;
  readonly allowLargeReduction: boolean;
}

export async function runPublisher(
  argv: readonly string[],
  runtime: PublisherRuntime = {},
): Promise<void> {
  const args = parsePublisherArguments(argv);
  const now = (runtime.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) throw invalidInput("now");
  const reader = (runtime.createReader ?? ((baseUrl) => new StrictHttpsReader({ baseUrl })))(
    args.previousBaseUrl,
  );

  const indexBytes = await reader.readOptional("v1/index.json", CATALOGUE_MAX_MANIFEST_BYTES);
  const priorIndex = indexBytes === undefined ? undefined : parseIndexBytes(indexBytes);
  if (priorIndex !== undefined && priorIndex.snapshots.length === 0) {
    throw snapshotInvalid("snapshots");
  }
  const retained = retainedManifests(priorIndex, now);
  const retainedArtifacts = await Promise.all(
    retained.map(async (manifest) => {
      const bytes = await reader.read(manifest.snapshotPath, CATALOGUE_MAX_SNAPSHOT_BYTES);
      parseCatalogueSnapshot(bytes, manifest);
      assertOneJsonNewline(bytes, manifest.snapshotPath);
      return { manifest, bytes };
    }),
  );

  const provider = (runtime.createProvider ?? createDefaultProvider)();
  const snapshot = await generateCatalogueSnapshot(provider, { generatedAt: now.toISOString() });
  const previousCount = priorIndex?.snapshots.toSorted(compareManifests)[0]?.count;
  assertSafeCount(previousCount, snapshot.count, args.allowLargeReduction);
  const publication = buildPublication(snapshot);
  const index: CatalogueIndex = {
    schemaVersion: CATALOGUE_SCHEMA_VERSION,
    snapshots: retainedManifests(
      {
        schemaVersion: CATALOGUE_SCHEMA_VERSION,
        snapshots: [...retained, publication.manifest],
      },
      now,
    ),
  };

  const output = resolve(args.output);
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const staged = await mkdtemp(join(parent, ".catalogue-site-"));
  try {
    const snapshotsDirectory = join(staged, "v1", "snapshots");
    await mkdir(snapshotsDirectory, { recursive: true });
    for (const artifact of retainedArtifacts) {
      await writeFile(join(staged, artifact.manifest.snapshotPath), artifact.bytes, {
        mode: 0o600,
      });
    }
    await writeFile(join(staged, publication.manifest.snapshotPath), publication.snapshotBytes, {
      mode: 0o600,
    });
    await writeJson(join(staged, "v1", "latest.json"), publication.manifest);
    await writeJson(join(staged, "v1", "index.json"), index);
    const deployment = {
      sha256: publication.manifest.sha256,
      generatedAt: publication.manifest.generatedAt,
    };
    await writeJson(join(staged, "deployment.json"), deployment);
    await rename(staged, output);
    (runtime.writeStdout ?? ((value) => process.stdout.write(value)))(
      `${JSON.stringify(deployment)}\n`,
    );
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

function createDefaultProvider(): DataProvider {
  return new OpsiProvider(new OpsiTransport({ scheduler: new RequestScheduler() }));
}

function parsePublisherArguments(argv: readonly string[]): PublisherArguments {
  let output: string | undefined;
  let previousBaseUrl: string | undefined;
  let allowLargeReduction = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-large-reduction") {
      if (allowLargeReduction) throw invalidInput("allow-large-reduction");
      allowLargeReduction = true;
      continue;
    }
    if (argument !== "--output" && argument !== "--previous-base-url") {
      throw invalidInput("arguments");
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw invalidInput(argument.slice(2));
    index += 1;
    if (argument === "--output") {
      if (output !== undefined) throw invalidInput("output");
      output = value;
    } else {
      if (previousBaseUrl !== undefined) throw invalidInput("previous-base-url");
      previousBaseUrl = value;
    }
  }
  if (output === undefined) throw invalidInput("output");
  if (previousBaseUrl === undefined) throw invalidInput("previous-base-url");
  return { output, previousBaseUrl, allowLargeReduction };
}

function parseIndexBytes(bytes: Uint8Array): CatalogueIndex {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return parseCatalogueIndex(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof OpsiError) throw error;
    throw snapshotInvalid("index");
  }
}

function assertOneJsonNewline(bytes: Uint8Array, field: string): void {
  if (bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a) throw snapshotInvalid(field);
}

function compareManifests(
  left: CatalogueIndex["snapshots"][number],
  right: CatalogueIndex["snapshots"][number],
): number {
  return (
    Date.parse(right.generatedAt) - Date.parse(left.generatedAt) ||
    (left.snapshotPath < right.snapshotPath ? -1 : left.snapshotPath > right.snapshotPath ? 1 : 0)
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function invalidInput(field: string): OpsiError {
  return new OpsiError({
    code: "INVALID_CATALOGUE_PUBLICATION_ARGUMENT",
    message: "The catalogue publisher arguments are invalid.",
    exitCode: EXIT_CODES.INVALID_INPUT,
    context: { field },
  });
}

export function formatPublisherError(error: unknown): string {
  if (error instanceof OpsiError) return `${JSON.stringify(error.toJSON())}\n`;
  return `${error instanceof Error ? error.message : "Catalogue publication failed."}\n`;
}

async function main(): Promise<void> {
  try {
    await runPublisher(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(formatPublisherError(error));
    process.exitCode = error instanceof OpsiError ? error.exitCode : 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && realpathSync(entrypoint) === fileURLToPath(import.meta.url)) {
  await main();
}

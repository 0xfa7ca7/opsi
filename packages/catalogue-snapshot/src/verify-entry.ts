#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import {
  CATALOGUE_MAX_MANIFEST_BYTES,
  CATALOGUE_MAX_SNAPSHOT_BYTES,
  parseCatalogueManifest,
  parseCatalogueSnapshot,
  type CatalogueManifest,
} from "./contracts.js";
import { StrictHttpsReader } from "./remote.js";
import { snapshotInvalid } from "./errors.js";

export interface VerifierRuntime {
  readonly createReader?: (baseUrl: string) => StrictHttpsReader;
  readonly cacheBust?: () => string;
}

interface VerifierArguments {
  readonly baseUrl: string;
  readonly expectedSha256: string;
  readonly expectedGeneratedAt: string;
}

export async function runPublicVerifier(
  argv: readonly string[],
  runtime: VerifierRuntime = {},
): Promise<void> {
  const args = parseVerifierArguments(argv);
  const reader = (runtime.createReader ?? ((baseUrl) => new StrictHttpsReader({ baseUrl })))(
    args.baseUrl,
  );
  const manifestBytes = await reader.readCacheBusted(
    "v1/latest.json",
    CATALOGUE_MAX_MANIFEST_BYTES,
    (runtime.cacheBust ?? randomUUID)(),
  );
  const manifest = parseManifestBytes(manifestBytes);
  const snapshotBytes = await reader.read(manifest.snapshotPath, CATALOGUE_MAX_SNAPSHOT_BYTES);
  parseCatalogueSnapshot(snapshotBytes, manifest);
  if (
    manifest.sha256 !== args.expectedSha256 ||
    manifest.generatedAt !== args.expectedGeneratedAt
  ) {
    throw new OpsiError({
      code: "CATALOGUE_DEPLOYMENT_MISMATCH",
      message: "The public catalogue does not match the expected deployment.",
      exitCode: EXIT_CODES.PROVIDER_FAILURE,
    });
  }
}

function parseVerifierArguments(argv: readonly string[]): VerifierArguments {
  const values = new Map<string, string>();
  const allowed = new Set(["--base-url", "--expected-sha256", "--expected-generated-at"]);
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (
      argument === undefined ||
      !allowed.has(argument) ||
      value === undefined ||
      value.startsWith("--") ||
      values.has(argument)
    ) {
      throw invalidInput("arguments");
    }
    values.set(argument, value);
  }
  const baseUrl = values.get("--base-url");
  const expectedSha256 = values.get("--expected-sha256");
  const expectedGeneratedAt = values.get("--expected-generated-at");
  if (baseUrl === undefined) throw invalidInput("base-url");
  if (expectedSha256 === undefined || !/^[a-f0-9]{64}$/u.test(expectedSha256))
    throw invalidInput("expected-sha256");
  if (expectedGeneratedAt === undefined || Number.isNaN(Date.parse(expectedGeneratedAt)))
    throw invalidInput("expected-generated-at");
  return { baseUrl, expectedSha256, expectedGeneratedAt };
}

function parseManifestBytes(bytes: Uint8Array): CatalogueManifest {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return parseCatalogueManifest(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof OpsiError) throw error;
    throw snapshotInvalid("manifest");
  }
}

function invalidInput(field: string): OpsiError {
  return new OpsiError({
    code: "INVALID_CATALOGUE_VERIFIER_ARGUMENT",
    message: "The catalogue verifier arguments are invalid.",
    exitCode: EXIT_CODES.INVALID_INPUT,
    context: { field },
  });
}

async function main(): Promise<void> {
  try {
    await runPublicVerifier(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Public verification failed."}\n`,
    );
    process.exitCode = error instanceof OpsiError ? error.exitCode : 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && realpathSync(entrypoint) === fileURLToPath(import.meta.url)) {
  await main();
}

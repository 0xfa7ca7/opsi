#!/usr/bin/env node

import { readFileSync } from "node:fs";

interface PackageMetadata {
  readonly version?: unknown;
}

export function readPackageVersion(
  packageUrl: URL = new URL("../package.json", import.meta.url),
): string {
  const metadata = JSON.parse(readFileSync(packageUrl, "utf8")) as PackageMetadata;
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Invalid package version metadata at ${packageUrl.href}`);
  }
  return metadata.version;
}

export const VERSION = readPackageVersion();

if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION}\n`);
}

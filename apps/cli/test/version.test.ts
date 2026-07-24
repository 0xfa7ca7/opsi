import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as cli from "../src/main.js";

interface CliModule {
  readonly VERSION?: string;
  readonly readPackageVersion?: (url: URL) => string;
}

const cliModule = cli as CliModule;
const packageUrl = new URL("../package.json", import.meta.url);
const packageMetadata = JSON.parse(readFileSync(packageUrl, "utf8")) as {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly engines?: { readonly node?: string };
  readonly repository?: {
    readonly type?: string;
    readonly url?: string;
  };
};
const changesetsConfig = JSON.parse(
  readFileSync(new URL("../../../.changeset/config.json", import.meta.url), "utf8"),
) as { readonly access?: string; readonly baseBranch?: string };
const internalPackages = [
  new URL("../../../packages/domain/package.json", import.meta.url),
  new URL("../../../packages/testing/package.json", import.meta.url),
].map(
  (url) =>
    JSON.parse(readFileSync(url, "utf8")) as {
      readonly private?: boolean;
    },
);

describe("public CLI package", () => {
  it("uses the public klopsi identity while internal packages stay private", () => {
    expect(packageMetadata).toMatchObject({
      name: "klopsi",
      engines: { node: ">=24.0.0" },
    });
    expect(packageMetadata.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(packageMetadata.private).toBeUndefined();
    expect(changesetsConfig.access).toBe("public");
    expect(internalPackages.every((metadata) => metadata.private === true)).toBe(true);
  });

  it("binds releases to the canonical public repository", () => {
    expect(packageMetadata.repository).toEqual({
      type: "git",
      url: "git+https://github.com/0xfa7ca7/klopsi.git",
    });
  });

  it("uses the repository default branch for Changesets", () => {
    expect(changesetsConfig.baseBranch).toBe("main");
  });

  it("reads version metadata instead of duplicating the package version", () => {
    expect(cliModule.readPackageVersion).toBeTypeOf("function");
    if (cliModule.readPackageVersion === undefined) return;

    const directory = mkdtempSync(join(tmpdir(), "klopsi-version-"));
    const metadataPath = join(directory, "package.json");

    try {
      writeFileSync(metadataPath, JSON.stringify({ version: "9.8.7" }));
      expect(cliModule.readPackageVersion(new URL(`file://${metadataPath}`))).toBe("9.8.7");
      expect(cliModule.VERSION).toBe(packageMetadata.version);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

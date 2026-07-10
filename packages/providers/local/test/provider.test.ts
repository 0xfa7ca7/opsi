import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalProvider } from "../src/index.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("LocalProvider", () => {
  it("resolves paths relative to the configured working directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opsi-local-"));
    temporary.push(directory);
    await writeFile(join(directory, "data.csv"), "id\n1\n");

    await expect(new LocalProvider({ cwd: directory }).resolve("data.csv")).resolves.toMatchObject({
      path: resolve(directory, "data.csv"),
      reference: `local:file:${resolve(directory, "data.csv")}`,
      sizeBytes: 5,
    });
  });

  it("accepts canonical local file references", async () => {
    const path = resolve("packages/testing/fixtures/data/valid.csv");

    await expect(new LocalProvider().resolve(`local:file:${path}`)).resolves.toMatchObject({
      path,
    });
  });

  it("rejects directories and missing files with stable errors", async () => {
    const provider = new LocalProvider();

    await expect(provider.resolve("missing.csv")).rejects.toMatchObject({
      code: "LOCAL_FILE_NOT_FOUND",
      exitCode: 3,
    });
    await expect(provider.resolve(".")).rejects.toMatchObject({
      code: "LOCAL_FILE_NOT_REGULAR",
      exitCode: 2,
    });
  });
});

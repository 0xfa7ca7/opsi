import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProvenanceStore, redactUrl } from "@klopsi/storage";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);
describe("ProvenanceStore", () => {
  it("redacts URL secrets and verifies durable artifact size and checksum", async () => {
    const root = await mkdtemp(join(tmpdir(), "klopsi-provenance-"));
    roots.push(root);
    const artifact = join(root, "file.txt");
    await writeFile(artifact, "hello");
    const sha256 = createHash("sha256").update("hello").digest("hex");
    const store = new ProvenanceStore();
    const path = await store.write(artifact, {
      sourceUrl: "https://example.com/file?token=secret&x=1",
      finalUrl: "https://example.com/final?api_key=hidden",
      redirectChain: ["https://example.com/file?signature=bad"],
      retrievedAt: new Date().toISOString(),
      sha256,
      bytes: 5,
      overrideFlags: { allowPrivateNetwork: false, allowInsecureHttp: false },
    });
    expect(await readFile(path, "utf8")).not.toContain("secret");
    expect(await store.verify(artifact)).toMatchObject({ valid: true, sha256, bytes: 5 });
    await writeFile(artifact, "tampered");
    await expect(store.verify(artifact)).rejects.toMatchObject({
      code: "PROVENANCE_INTEGRITY_FAILURE",
      exitCode: 6,
    });
    expect(redactUrl("https://u:p@example.com/a?access_token=x&ok=y")).toBe(
      "https://example.com/a?access_token=REDACTED&ok=y",
    );
  });
});

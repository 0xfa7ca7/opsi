import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishArtifactPair } from "@opsi/storage";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(label: string) {
  const root = await mkdtemp(join(tmpdir(), "opsi-pair-"));
  roots.push(root);
  const artifact = join(root, `${label}.part`);
  const sidecar = join(root, `${label}.provenance.part`);
  await writeFile(artifact, label);
  await writeFile(sidecar, JSON.stringify({ label }));
  return { root, artifact, sidecar };
}

describe("paired artifact publication", () => {
  it("rolls back the artifact if sidecar publication fails", async () => {
    const item = await fixture("new");
    const destination = join(item.root, "result.csv");
    await expect(
      publishArtifactPair(item.artifact, item.sidecar, destination, {
        fault: (point) => {
          if (point === "artifact-published") throw new Error("injected");
        },
      }),
    ).rejects.toThrow("injected");
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(`${destination}.provenance.json`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("allows exactly one concurrent no-clobber winner with a matching sidecar", async () => {
    const first = await fixture("first");
    const secondArtifact = join(first.root, "second.part");
    const secondSidecar = join(first.root, "second.provenance.part");
    await writeFile(secondArtifact, "second");
    await writeFile(secondSidecar, JSON.stringify({ label: "second" }));
    const destination = join(first.root, "result.csv");
    const settled = await Promise.allSettled([
      publishArtifactPair(first.artifact, first.sidecar, destination),
      publishArtifactPair(secondArtifact, secondSidecar, destination),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const artifact = await readFile(destination, "utf8");
    const sidecar = JSON.parse(await readFile(`${destination}.provenance.json`, "utf8")) as {
      label: string;
    };
    expect(sidecar.label).toBe(artifact);
  });

  it.each([
    ["artifact-backup-remove", "result.csv.backup-", "result.csv.provenance.json.backup-"],
    ["sidecar-backup-remove", "result.csv.provenance.json.backup-", "result.csv.backup-"],
  ])(
    "keeps the committed new pair and recovery path when %s fails",
    async (point, retained, removed) => {
      const item = await fixture("new");
      const destination = join(item.root, "result.csv");
      await writeFile(destination, "old");
      await writeFile(`${destination}.provenance.json`, JSON.stringify({ label: "old" }));
      await expect(
        publishArtifactPair(item.artifact, item.sidecar, destination, {
          force: true,
          fault: ((candidate: string) => {
            if (candidate === point) throw new Error(`injected ${point}`);
          }) as never,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_PUBLICATION_CLEANUP_FAILED", exitCode: 6 });
      expect(await readFile(destination, "utf8")).toBe("new");
      expect(JSON.parse(await readFile(`${destination}.provenance.json`, "utf8"))).toEqual({
        label: "new",
      });
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(item.root);
      expect(files.some((name) => name.startsWith(retained))).toBe(true);
      expect(files.some((name) => name.startsWith(removed))).toBe(false);
    },
  );

  it("reports a typed rollback failure and retains the original backup when restore fails", async () => {
    const item = await fixture("new");
    const destination = join(item.root, "result.csv");
    await writeFile(destination, "old");
    await writeFile(`${destination}.provenance.json`, JSON.stringify({ label: "old" }));
    await expect(
      publishArtifactPair(item.artifact, item.sidecar, destination, {
        force: true,
        fault: ((point: string) => {
          if (point === "artifact-published" || point === "artifact-restore")
            throw new Error(`injected ${point}`);
        }) as never,
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_PUBLICATION_ROLLBACK_FAILED",
      exitCode: 6,
      context: {
        recoveryPaths: expect.arrayContaining([expect.stringContaining("result.csv.backup-")]),
      },
    });
    expect(JSON.parse(await readFile(`${destination}.provenance.json`, "utf8"))).toEqual({
      label: "old",
    });
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(item.root)).some((name) => name.startsWith("result.csv.backup-"))).toBe(
      true,
    );
  });
});

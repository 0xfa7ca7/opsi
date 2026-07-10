import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { datasetId, providerId, resourceId } from "@opsi/domain";
import type { OpsiClient } from "@opsi/core";
import { Renderer } from "@opsi/output";
import {
  GLOBAL_OPTION_MANIFEST,
  registerCommandManifest,
  registerGlobalOptions,
} from "../src/command-manifest.js";
import { registerSearchCommand } from "../src/commands/search.js";
import { registerDownloadCommand } from "../src/commands/download.js";

function context(writes: string[] = []) {
  return {
    version: "1.0.0",
    io: { stdout: { write() {} }, stderr: { write() {} } },
    renderer: new Renderer({
      format: "json",
      stdout: { write: (chunk) => void writes.push(chunk) },
    }),
  };
}

describe("final command contracts", () => {
  it("declares --fields globally and --all/selectors only in the normalized manifest", () => {
    expect(GLOBAL_OPTION_MANIFEST).toContainEqual(
      expect.objectContaining({ flags: "--fields <field>" }),
    );
    const program = new Command();
    registerGlobalOptions(program);
    registerCommandManifest(program);
    expect(program.options.map((option) => option.flags)).toContain("--fields <field>");
    expect(
      program.commands
        .find((command) => command.name() === "search")
        ?.options.map((option) => option.flags),
    ).toContain("--all");
    expect(
      program.commands
        .find((command) => command.name() === "download")
        ?.options.map((option) => option.flags),
    ).toEqual(expect.arrayContaining(["--dataset", "--resource"]));
  });

  it("traverses --all pages deterministically and emits one bounded result", async () => {
    const writes: string[] = [];
    const search = vi.fn(async ({ offset = 0 }: { offset?: number }) => ({
      items: [{ id: datasetId(`d${offset}`), providerId: providerId("opsi"), title: `D${offset}` }],
      total: 3,
      limit: 1,
      offset,
      ...(offset < 2 ? { nextOffset: offset + 1 } : {}),
    }));
    const program = new Command();
    registerCommandManifest(program);
    registerSearchCommand(program, context(writes), { search } as unknown as OpsiClient);
    await program.parseAsync(["search", "x", "--all"], { from: "user" });
    expect(search.mock.calls.map(([query]) => query.offset ?? 0)).toEqual([0, 1, 2]);
    expect(JSON.parse(writes.join(""))).toMatchObject({
      data: [{ id: "d0" }, { id: "d1" }, { id: "d2" }],
      meta: { total: 3, all: true, pages: 3 },
    });
  });

  it("returns a typed provider error for non-advancing --all pagination", async () => {
    const page = { items: [], total: 2, limit: 1, offset: 0, nextOffset: 0 };
    const program = new Command();
    registerCommandManifest(program);
    registerSearchCommand(program, context(), {
      search: vi.fn(async () => page),
    } as unknown as OpsiClient);
    await expect(
      program.parseAsync(["search", "x", "--all"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "SEARCH_PAGINATION_INVALID",
      exitCode: 4,
      suggestion: expect.any(String),
    });
  });

  it("returns an exact local usage error when --all exceeds its result cap", async () => {
    const page = { items: [], total: 10_001, limit: 10, offset: 0, nextOffset: 10 };
    const program = new Command();
    registerCommandManifest(program);
    registerSearchCommand(program, context(), {
      search: vi.fn(async () => page),
    } as unknown as OpsiClient);
    await expect(
      program.parseAsync(["search", "x", "--all"], { from: "user" }),
    ).rejects.toMatchObject({
      code: "SEARCH_RESULT_LIMIT_EXCEEDED",
      exitCode: 2,
      message: "Search --all is limited to 10000 results.",
      suggestion: "Narrow the search or use --limit and --offset.",
    });
  });

  it("rejects ambiguous bare downloads and expands explicit dataset selection", async () => {
    const resource = {
      id: resourceId("r1"),
      datasetId: datasetId("d1"),
      providerId: providerId("opsi"),
      title: "R",
      url: "https://example.test/r",
    };
    const download = vi.fn(async () => ({ path: "/tmp/r", bytes: 1, sha256: "a".repeat(64) }));
    const client = {
      datasets: { resources: vi.fn(async () => [resource]) },
      downloads: { resource: download },
    } as unknown as OpsiClient;
    const ambiguous = new Command();
    registerCommandManifest(ambiguous);
    registerDownloadCommand(ambiguous, context(), client);
    await expect(ambiguous.parseAsync(["download", "r1"], { from: "user" })).rejects.toMatchObject({
      code: "AMBIGUOUS_DOWNLOAD_REFERENCE",
      exitCode: 2,
    });
    const selected = new Command();
    registerCommandManifest(selected);
    registerDownloadCommand(selected, context(), client);
    await selected.parseAsync(["download", "d1", "--dataset"], { from: "user" });
    expect(download).toHaveBeenCalledWith(resource.id, expect.objectContaining({ force: false }));

    const mismatch = new Command();
    registerCommandManifest(mismatch);
    registerDownloadCommand(mismatch, context(), client);
    await expect(
      mismatch.parseAsync(["download", "opsi:resource:r1", "--dataset"], { from: "user" }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_SELECTOR_MISMATCH", exitCode: 2 });
  });
});

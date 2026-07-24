import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("chart experiment documentation", () => {
  it.each(["README.md", "apps/cli/README.md", "docs/commands.md"])(
    "documents the CLI contract in %s",
    async (path) => {
      const content = await readFile(path, "utf8");
      for (const required of [
        "klopsi chart",
        "bar",
        "line",
        "offline",
        "source order",
        "--force",
        "provenance verify",
      ])
        expect(content, `${path}: ${required}`).toContain(required);
    },
  );

  it("documents default and maximum point bounds in the command reference", async () => {
    const content = await readFile("docs/commands.md", "utf8");
    expect(content).toContain("defaults to 100");
    expect(content).toContain("maximum of 500");
    expect(content).toContain("no JavaScript");
    expect(content).toContain("issue #28");
  });

  it("ships a package changeset scoped to the experiment", async () => {
    const content = await readFile(".changeset/deterministic-static-chart.md", "utf8");
    expect(content).toContain('"klopsi": minor');
    expect(content).toContain("experimental");
    expect(content).not.toContain("dashboard renderer");
  });
});

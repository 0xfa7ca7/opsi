import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const text = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("clean CI and release contract", () => {
  it("keeps pack tests after build and ordinary tests independent of dist", async () => {
    const rootPackage = JSON.parse(await text("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts.test).toContain("pnpm build");
    expect(rootPackage.scripts.test).toContain("pnpm test:e2e");
    expect(rootPackage.scripts["test:e2e"]).toContain("apps/cli/test/*.e2e.test.ts");
    expect(rootPackage.scripts["test:e2e"]).not.toContain("pack.test.ts");
    expect(rootPackage.scripts["test:pack"]).toContain("apps/cli/test/pack.test.ts");

    const ci = await text(".github/workflows/ci.yml");
    expect(ci).toContain("rm -rf apps/cli/dist packages/*/dist packages/providers/*/dist");
    expect(ci.indexOf("pnpm build")).toBeLessThan(ci.indexOf("pnpm test:unit"));
    expect(ci.indexOf("pnpm test:unit")).toBeLessThan(ci.indexOf("pnpm test:e2e"));
    expect(ci.indexOf("pnpm test:e2e")).toBeLessThan(ci.indexOf("pnpm test:pack"));
  });

  it("uses explicit supported target assertions", async () => {
    const ci = await text(".github/workflows/ci.yml");
    expect(ci).toContain("os: ubuntu-latest");
    expect(ci).toContain("platform: linux");
    expect(ci).toContain("arch: x64");
    expect(ci).toContain("libc: glibc");
    expect(ci).toContain("os: macos-14");
    expect(ci).toContain("platform: darwin");
    expect(ci).toContain("arch: arm64");
    expect(ci).toContain("os: windows-latest");
    expect(ci).toContain("platform: win32");
    expect(ci).toContain("facts.platform!==process.env.EXPECTED_PLATFORM");
    expect(ci).toContain("facts.arch!==process.env.EXPECTED_ARCH");
    expect(ci).toContain('EXPECTED_LIBC==="glibc"&&!facts.glibc');
  });

  it("binds release bytes to the protected tag and creates GitHub Release assets", async () => {
    const release = await text(".github/workflows/release.yml");
    expect(release).toContain("environment: npm");
    expect(release).toContain('test "$GITHUB_REF_PROTECTED" = "true"');
    expect(release).toContain("head_sha=$GITHUB_SHA");
    expect(release).toContain("event=push");
    expect(release).toContain("branch=$GITHUB_REF_NAME");
    expect(release).toContain('test "$CI_HEAD_SHA" = "$GITHUB_SHA"');
    expect(release).toContain('test "$CI_EVENT" = "push"');
    expect(release).toMatch(/npm pack [^\n]+ --dry-run/u);
    expect(release).toContain("dist.integrity");
    expect(release).toContain("EXPECTED_INTEGRITY");
    expect(release).toContain("gh release create");
    expect(release).toContain("--verify-tag");
    expect(release).toContain('--target "$GITHUB_SHA"');
    expect(release).toContain("artifacts/SHA256SUMS");
    expect(release).not.toContain("pnpm build");
  });

  it("keeps required third-party actions pinned exactly", async () => {
    const workflows = `${await text(".github/workflows/ci.yml")}\n${await text(".github/workflows/release.yml")}`;
    for (const pin of [
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
      "actions/attest-build-provenance@96b4a1ef7235a096b17240c259729fdd70c83d45",
    ])
      expect(workflows).toContain(pin);
    expect(workflows).not.toMatch(/uses:\s+actions\/[\w-]+@v\d/gu);
  });
});

describe("documentation contract", () => {
  it("ships the complete MIT license in both locations", async () => {
    const root = await text("LICENSE");
    const packaged = await text("apps/cli/LICENSE");
    expect(packaged).toBe(root);
    expect(root).toContain("Permission is hereby granted, free of charge");
    expect(root).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(root.length).toBeGreaterThan(1_000);
  });

  it("ships substantial user and extension references", async () => {
    for (const path of [
      "docs/commands.md",
      "docs/architecture.md",
      "docs/configuration.md",
      "docs/providers.md",
      "docs/formats.md",
      "docs/security.md",
      "docs/recipes.md",
      "docs/releases.md",
      "docs/installation.md",
    ]) {
      const document = await text(path);
      expect(document.length, path).toBeGreaterThan(1_500);
    }
    const commands = await text("docs/commands.md");
    for (const command of [
      "search",
      "dataset show",
      "dataset resources",
      "dataset schema",
      "dataset open",
      "resource show",
      "resource preview",
      "resource headers",
      "download",
      "query",
      "convert",
      "validate",
      "provenance show",
      "provenance verify",
      "providers list",
      "cache info",
      "cache list",
      "cache clear",
      "cache prune",
      "cache verify",
      "config get",
      "config set",
      "config list",
      "config path",
      "doctor",
      "completion",
    ])
      expect(commands, command).toContain(`\`${command}`);
  });
});

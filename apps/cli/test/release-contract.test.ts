import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { AGENT_SKILLS } from "../src/agent-skills.js";
import {
  COMMAND_MANIFEST,
  GLOBAL_OPTION_MANIFEST,
  registerCommandManifest,
} from "../src/command-manifest.js";

const text = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

function commandReferenceSections(document: string): ReadonlyMap<string, string> {
  const sections = new Map<string, string>();
  for (const section of document.split(/^### /mu).slice(1)) {
    const match = /^`([^`]+)`\n/u.exec(section);
    if (match?.[1] !== undefined) sections.set(match[1], section.split(/^## /mu)[0] ?? section);
  }
  return sections;
}

function longFlag(flags: string): string {
  const match = /--[a-z][a-z-]*/u.exec(flags);
  if (match === null) throw new Error(`Option has no long flag: ${flags}`);
  return match[0];
}

describe("clean CI and release contract", () => {
  it("keeps pack tests after build and ordinary tests independent of dist", async () => {
    const rootPackage = JSON.parse(await text("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts.test).toContain("pnpm build");
    expect(rootPackage.scripts.typecheck).toMatch(/^pnpm build && /u);
    expect(rootPackage.scripts.test).toContain("pnpm test:e2e");
    expect(rootPackage.scripts["test:e2e"]).toContain("apps/cli/test/*.e2e.test.ts");
    expect(rootPackage.scripts["test:e2e"]).not.toContain("pack.test.ts");
    expect(rootPackage.scripts["test:pack"]).toContain("apps/cli/test/pack.test.ts");

    const cliPackage = JSON.parse(await text("apps/cli/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(cliPackage.scripts.typecheck).toContain("--filter @opsi/data-engine");
    expect(cliPackage.scripts.typecheck).toContain("--filter @opsi/provider-local");

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
    expect(release).toContain("BOOTSTRAP_NPM_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(release).toContain('if [ "$VERSION" = "0.0.1" ]; then');
    expect(release).toContain('test -n "$BOOTSTRAP_NPM_TOKEN"');
    expect(release).toContain('test -z "$BOOTSTRAP_NPM_TOKEN"');
    expect(release).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
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
      "docs/skills.md",
    ]) {
      const document = await text(path);
      expect(document.length, path).toBeGreaterThan(1_500);
    }
  });

  it("documents the first public release handoff", async () => {
    const releases = await text("docs/releases.md");
    expect(releases).toContain("## First public release: 0.0.1");
    expect(releases).toContain("npm view opsi@0.0.1 version");
    expect(releases).toContain('git tag -a v0.0.1 -m "opsi 0.0.1"');
    expect(releases).toContain("git push origin v0.0.1");
    expect(releases).toContain("Never run `npm publish` locally");
    expect(releases).toContain("npm trust github opsi");
    expect(releases).toContain("gh secret delete NPM_TOKEN --env npm");
  });

  it("keeps the command reference synchronized with the normalized manifest", async () => {
    const document = await text("docs/commands.md");
    const globalReference = document.split(/^### /mu)[0] ?? "";
    const sections = commandReferenceSections(document);

    for (const option of GLOBAL_OPTION_MANIFEST) {
      expect(globalReference, `global option ${option.flags}`).toContain(longFlag(option.flags));
    }
    for (const command of COMMAND_MANIFEST) {
      const section = sections.get(command.path);
      expect(section, `command section ${command.path}`).toBeDefined();
      for (const option of command.options) {
        expect(
          `${globalReference}\n${section}`,
          `${command.path} option ${option.flags}`,
        ).toContain(longFlag(option.flags));
      }
    }
  });

  it("gives the WFS service command group descriptive help", () => {
    const program = new Command();
    registerCommandManifest(program);
    const service = program.commands.find((command) => command.name() === "service");
    expect(service?.description()).toBe("Inspect read-only WFS services");
  });

  it("documents installable Agent Skills and their generated release contract", async () => {
    const readme = await text("README.md");
    for (const expected of [
      "npx skills add https://github.com/0xfa7ca7/opsi",
      "npx skills add https://github.com/0xfa7ca7/opsi/tree/main/skills/opsi-analysis",
      "opsi generate-skills",
      "opsi agent setup",
      "docs/skills.md",
      "/opsi",
      "@opsi",
      "$opsi",
    ]) {
      expect(readme).toContain(expected);
    }

    const commands = await text("docs/commands.md");
    expect(commands).toContain("`generate-skills`");
    expect(commands).toContain("`agent setup`");
    expect(commands).toContain("automatic agent detection");
    expect(commands).toContain("`--output-dir`");
    expect(commands).toContain("known generated `SKILL.md` targets");
    expect(commands).toContain("structured output");

    const packagedReadme = await text("apps/cli/README.md");
    expect(packagedReadme).toContain("opsi generate-skills");
    expect(packagedReadme).toContain("opsi agent setup");
    expect(packagedReadme).toContain("docs/skills.md");

    const changelog = await text("apps/cli/CHANGELOG.md");
    expect(changelog).toMatch(/^# opsi\n\n## 0\.0\.1\n/u);
    expect(changelog).not.toMatch(/^## 0\.[12]\.0$/mu);

    for (const skill of AGENT_SKILLS) {
      const generated = await text(`skills/${skill.name}/SKILL.md`);
      expect(generated, skill.name).toContain("Generated for `opsi` 0.0.1.");
    }
  });
});

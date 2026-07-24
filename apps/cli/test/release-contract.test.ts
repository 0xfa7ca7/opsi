import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { AGENT_SKILLS } from "../src/agent-skills.js";
import {
  COMMAND_MANIFEST,
  GLOBAL_OPTION_MANIFEST,
  registerCommandManifest,
} from "../src/command-manifest.js";

const text = (path: string) => readFile(resolve(process.cwd(), path), "utf8");
const execFileAsync = promisify(execFile);

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
  it("uses klopsi for the product and OPSI for the government catalogue provider", async () => {
    const cliPackage = JSON.parse(await text("apps/cli/package.json")) as {
      name: string;
      bin: Record<string, string>;
      repository: { type: string; url: string };
    };
    expect(cliPackage.name).toBe("klopsi");
    expect(cliPackage.bin).toEqual({ klopsi: "dist/main.js" });
    expect(cliPackage.repository).toEqual({
      type: "git",
      url: "git+https://github.com/0xfa7ca7/klopsi.git",
    });

    const release = await text(".github/workflows/release.yml");
    expect(release).toContain('test "$NAME" = "klopsi"');
    expect(release).toContain('npm view "klopsi@$VERSION"');
    expect(release).toContain('npm install "klopsi@$VERSION"');
    expect(release).toContain("./node_modules/.bin/klopsi --version");

    const readme = await text("README.md");
    expect(readme).toContain("npm install --global klopsi");
    expect(readme).toContain('from "klopsi/sdk"');
    expect(readme).toContain("Search Slovenia's [OPSI](https://podatki.gov.si/) catalogue");

    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { encoding: "utf8" });
    const paths = stdout.split("\0").filter(Boolean);
    const productLower = ["klop", "si"].join("");
    const productTitle = ["Klop", "si"].join("");
    const productUpper = productLower.toUpperCase();
    const formerRepository = `0xfa7ca7/${["op", "si"].join("")}`;
    expect(paths).toContain("packages/providers/opsi/package.json");
    expect(paths).toContain("packages/testing/fixtures/opsi/package-search.json");
    expect(paths).not.toContain(`packages/providers/${productLower}/package.json`);
    if (!paths.includes("packages/providers/opsi/package.json")) return;

    const providerPackage = JSON.parse(await text("packages/providers/opsi/package.json")) as {
      name: string;
    };
    expect(providerPackage.name).toBe("@klopsi/provider-opsi");

    for (const path of paths) {
      const content = await text(path);
      expect(content, path).not.toContain(formerRepository);
      for (const invalid of [
        `@klopsi/provider-${productLower}`,
        `${productTitle}Provider`,
        `${productTitle}Transport`,
        `${productTitle}Operation`,
        `${productTitle}DatasetRecord`,
        `${productTitle}ResourceRecord`,
        `${productTitle}OrganizationRecord`,
        `${productTitle}LicenseRecord`,
        `${productTitle}TagRecord`,
        `${productUpper}_BASE_URL`,
        `${productUpper}_API_KEY`,
        `${productUpper}_REQUEST_INTERVAL_MS`,
        `providerId("${productLower}")`,
        `${productLower}:dataset:`,
        `${productLower}:resource:`,
      ])
        expect(content, path).not.toContain(invalid);
    }
  });

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
    expect(cliPackage.scripts.typecheck).toContain("--filter @klopsi/data-engine");
    expect(cliPackage.scripts.typecheck).toContain("--filter @klopsi/provider-local");
    expect(cliPackage.scripts.typecheck).toContain("--filter @klopsi/provider-opsi");

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
    expect(release).not.toContain("GITHUB_REF_PROTECTED");
    expect(release).not.toContain("repos/$GITHUB_REPOSITORY/rulesets");
    expect(release).toContain('test "$GITHUB_REF_TYPE" = "tag"');
    expect(release).toContain('test "$GITHUB_REF" = "refs/tags/$GITHUB_REF_NAME"');
    expect(release).toContain("head_sha=$GITHUB_SHA");
    expect(release).toContain("event=push");
    expect(release).toContain("branch=$GITHUB_REF_NAME");
    expect(release).toContain('if [ -n "$RUN_JSON" ]; then');
    expect(release).toContain('test -n "$RUN_JSON"');
    expect(release).not.toContain('test "$RUN_JSON" != "null"');
    expect(release).toContain('test "$CI_HEAD_SHA" = "$GITHUB_SHA"');
    expect(release).toContain('test "$CI_EVENT" = "push"');
    expect(release).toContain('TARBALL="$(find "$GITHUB_WORKSPACE/artifacts"');
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

  it("keeps Node 24-compatible third-party actions pinned exactly", async () => {
    const workflows = `${await text(".github/workflows/ci.yml")}\n${await text(".github/workflows/release.yml")}\n${await text(".github/workflows/catalogue-snapshot.yml")}`;
    for (const pin of [
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      "actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373",
    ])
      expect(workflows).toContain(pin);
    expect(workflows).not.toContain("node-version: 20");
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
    expect(releases).toContain("npm view klopsi@0.0.1 version");
    expect(releases).toContain('git tag -a v0.0.1 -m "klopsi 0.0.1"');
    expect(releases).toContain("git push origin v0.0.1");
    expect(releases).toContain("Never run `npm publish` locally");
    expect(releases).toContain("npm trust github klopsi");
    expect(releases).toContain("gh secret delete NPM_TOKEN --env npm");
  });

  it("documents audited tag recovery before an npm version exists", async () => {
    const releases = await text("docs/releases.md");
    expect(releases).toContain("npm still returns `E404`");
    expect(releases).toContain("no GitHub Release exists");
    expect(releases).toContain("retarget the annotated tag");
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
    const duckdb = program.commands.find((command) => command.name() === "duckdb");
    expect(duckdb?.description()).toBe("Open data in DuckDB UI");
  });

  it("documents the optional exploratory DuckDB UI dependency and security boundary", async () => {
    const documents = {
      readme: await text("README.md"),
      packagedReadme: await text("apps/cli/README.md"),
      commands: await text("docs/commands.md"),
      installation: await text("docs/installation.md"),
      security: await text("docs/security.md"),
    };

    for (const document of [documents.readme, documents.packagedReadme]) {
      expect(document).toContain("klopsi duckdb open ./downloads/data.csv");
      expect(document).toContain("klopsi duckdb open ./results.parquet --install");
      expect(document).toContain("klopsi duckdb install --yes");
      expect(document).toContain("table `data`");
    }
    expect(documents.commands).toContain("### `duckdb open`");
    expect(documents.commands).toContain("### `duckdb install`");
    expect(documents.commands).toContain("Closing DuckDB UI");
    expect(documents.installation).toContain("external DuckDB CLI");
    expect(documents.installation).toContain("`@duckdb/node-api`");
    expect(documents.security).toContain("DuckDB UI");
    expect(documents.security).toContain("not the bounded `klopsi query` sandbox");
  });

  it("documents the bounded input-only PC-Axis contract across user and architecture guides", async () => {
    const documents = {
      readme: await text("README.md"),
      architecture: await text("docs/architecture.md"),
      configuration: await text("docs/configuration.md"),
      formats: await text("docs/formats.md"),
      commands: await text("docs/commands.md"),
      recipes: await text("docs/recipes.md"),
    };

    expect(documents.readme).toContain("dense PC-Axis");
    expect(documents.readme).toContain("input-only");
    expect(documents.architecture).toContain("deterministic long-form");
    expect(documents.architecture).toContain("staging-contract");
    expect(documents.configuration).toContain("`maxMetadataBytes`: 16 MiB");
    expect(documents.configuration).toContain("`maxCells`: 100,000,000");
    expect(documents.configuration).toContain("`maxStagingBytes`: 1 GiB");

    for (const document of [documents.formats, documents.commands, documents.recipes]) {
      expect(document).toContain("value__symbol");
      expect(document).toContain("__code");
      expect(document).toContain("KEYS");
    }
    expect(documents.formats).toContain("windows-1250");
    expect(documents.formats).toContain("utf-8");
    expect(documents.formats).toContain("STUB");
    expect(documents.formats).toContain("HEADING");
    expect(documents.formats).toContain("PCAXIS_ENCODING_UNSUPPORTED");
    expect(documents.formats).toContain("PCAXIS_KEYS_UNSUPPORTED");
    expect(documents.commands).toContain("PC-Axis is accepted only as input");
    expect(documents.commands).toContain("normal provenance sidecar");
    expect(documents.recipes).toContain("061");
    expect(documents.recipes).toContain("IS NULL");
  });

  it("documents installable Agent Skills and their generated release contract", async () => {
    const readme = await text("README.md");
    for (const expected of [
      "npx skills add https://github.com/0xfa7ca7/klopsi",
      "npx skills add https://github.com/0xfa7ca7/klopsi/tree/main/skills/klopsi-analysis",
      "npx skills add https://github.com/0xfa7ca7/klopsi/tree/main/skills/klopsi-dataset-workbench",
      "npx skills add https://github.com/0xfa7ca7/klopsi/tree/main/skills/klopsi-static-dashboard",
      "npx skills add https://github.com/0xfa7ca7/klopsi/tree/main/skills/klopsi-interactive-dashboard",
      "klopsi generate-skills",
      "klopsi agent setup",
      "docs/skills.md",
      "/klopsi",
      "@klopsi",
      "$klopsi",
      "Run bare `klopsi` for guided getting-started steps",
      "agent-authored and contract-verified",
      "self-contained offline HTML",
      "issues/28",
    ]) {
      expect(readme).toContain(expected);
    }

    const commands = await text("docs/commands.md");
    expect(commands).toContain("`generate-skills`");
    expect(commands).toContain("`agent setup`");
    expect(commands).toContain("automatic agent detection");
    expect(commands).toContain("`--output-dir`");
    expect(commands).toContain("known generated files");
    expect(commands).toContain("nested templates, references, and scripts");
    expect(commands).toContain("structured output");
    expect(commands).toContain("sectioned human summary");

    const packagedReadme = await text("apps/cli/README.md");
    expect(packagedReadme).toContain("klopsi generate-skills");
    expect(packagedReadme).toContain("klopsi agent setup");
    expect(packagedReadme).toContain("docs/skills.md");
    expect(packagedReadme).toContain("Run bare `klopsi` for guided getting-started steps");
    expect(packagedReadme).toContain("agent-authored and contract-verified");
    expect(packagedReadme).toContain("self-contained offline HTML");
    expect(packagedReadme).toContain("tree/main/skills/klopsi-static-dashboard");
    expect(packagedReadme).toContain("tree/main/skills/klopsi-interactive-dashboard");
    expect(packagedReadme).toContain("tree/main/skills/klopsi-dataset-workbench");
    expect(packagedReadme).toContain("issues/28");

    const changelog = await text("apps/cli/CHANGELOG.md");
    expect(changelog).toMatch(/^# klopsi\n\n## 0\.0\.1\n/u);
    expect(changelog).not.toMatch(/^## 0\.[12]\.0$/mu);

    for (const skill of AGENT_SKILLS) {
      const generated = await text(`skills/${skill.name}/SKILL.md`);
      expect(generated, skill.name).toContain("Generated for `klopsi` 0.0.1.");
    }

    const pcAxisSkillTokens: Readonly<Record<string, readonly string[]>> = {
      "klopsi-shared": ["PC-Axis", "input-only", "long-form"],
      "klopsi-resources": ["__code", "zero-padded", "value__symbol"],
      "klopsi-validation": ["PCAXIS_KEYS_UNSUPPORTED", "PCAXIS_ENCODING_UNSUPPORTED"],
      "klopsi-analysis": ["source-symbol null", "CSV, TSV, JSON, NDJSON, XLSX, or Parquet"],
    };
    for (const [name, required] of Object.entries(pcAxisSkillTokens)) {
      const generated = await text(`skills/${name}/SKILL.md`);
      for (const token of required) expect(generated, `${name}: ${token}`).toContain(token);
    }
  });
});

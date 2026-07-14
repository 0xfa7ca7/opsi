import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/catalogue-snapshot.yml");

describe("catalogue snapshot workflow", () => {
  it("publishes from the default branch every six hours with serialized runs", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain('    - cron: "17 */6 * * *"');
    expect(workflow).toMatch(/^ {2}workflow_dispatch:\n/mu);
    expect(topLevelBlock(workflow, "concurrency").trimEnd()).toBe(
      "  group: catalogue-pages\n  cancel-in-progress: false",
    );

    const generate = jobBlock(workflow, "generate");
    const verify = jobBlock(workflow, "verify");
    expect(generate).toContain("      ref: ${{ github.event.repository.default_branch }}");
    expect(verify).toContain("      ref: ${{ github.event.repository.default_branch }}");
    expect(workflow.match(/pnpm install --frozen-lockfile/gu)).toHaveLength(2);
    const dependencyBuild = /- run: pnpm --filter @opsi\/catalogue-snapshot\.\.\. build/gu;
    expect(generate.match(dependencyBuild)).toHaveLength(1);
    expect(verify.match(dependencyBuild)).toHaveLength(1);
  });

  it("uses three jobs with exact least-privilege permissions", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const generate = jobBlock(workflow, "generate");
    const deploy = jobBlock(workflow, "deploy");
    const verify = jobBlock(workflow, "verify");

    expect(jobNames(workflow)).toEqual(["generate", "deploy", "verify"]);
    expect(jobSettingBlock(generate, "permissions")).toBe(
      "      contents: read\n      pages: read\n",
    );
    expect(jobSettingBlock(deploy, "permissions")).toBe(
      "      pages: write\n      id-token: write\n",
    );
    expect(jobSettingBlock(verify, "permissions")).toBe("      contents: read\n");
    expect(deploy).toContain("    needs: generate");
    expect(verify).toContain("    needs: [generate, deploy]");
    expect(deploy).toContain("      name: github-pages");
    expect(deploy).toContain("      url: ${{ steps.deployment.outputs.page_url }}");
  });

  it("wires the manual large-reduction input into the snapshot step", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const dispatch = indentedBlock(topLevelBlock(workflow, "on"), "  workflow_dispatch:\n", 2);
    const inputs = indentedBlock(dispatch, "    inputs:\n", 4);
    const allowLargeReduction = indentedBlock(inputs, "      allow_large_reduction:\n", 6);
    const snapshot = jobStepBlock(jobBlock(workflow, "generate"), "snapshot");

    expect(yamlValue(allowLargeReduction, "type")).toBe("boolean");
    expect(yamlValue(allowLargeReduction, "required")).toBe("false");
    expect(yamlValue(allowLargeReduction, "default")).toBe("false");
    expect(expressionValue(snapshot, "ALLOW_LARGE_REDUCTION")).toBe(
      "${{inputs.allow_large_reduction||false}}",
    );
  });

  it("exports validated generation metadata with fixed output keys", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const generate = jobBlock(workflow, "generate");
    const outputs = jobSettingBlock(generate, "outputs");
    const snapshot = jobStepBlock(generate, "snapshot");

    expect(expressionValue(outputs, "sha256")).toBe("${{steps.snapshot.outputs.sha256}}");
    expect(expressionValue(outputs, "generated-at")).toBe(
      "${{steps.snapshot.outputs.generated-at}}",
    );
    expect(snapshot).toMatch(/readFileSync\(\s*"site\/deployment\.json"\s*,\s*"utf8"\s*\)/u);
    expect(snapshot).toMatch(/\/\^\[a-f0-9\]\{64\}\$\/\.test\(\s*value\.sha256\s*\)/u);
    expect(snapshot).toMatch(/Number\.isNaN\(\s*Date\.parse\(\s*value\.generatedAt\s*\)\s*\)/u);
    expect(snapshot).toMatch(
      /process\.stdout\.write\(\s*`sha256=\$\{value\.sha256\}\\ngenerated-at=\$\{value\.generatedAt\}\\n`\s*\)/u,
    );
    expect(snapshot).toMatch(/'\s*>>\s*"\$GITHUB_OUTPUT"/u);
  });

  it("exports the deployed Pages URL", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const outputs = jobSettingBlock(jobBlock(workflow, "deploy"), "outputs");

    expect(expressionValue(outputs, "page-url")).toBe("${{steps.deployment.outputs.page_url}}");
  });

  it("verifies the public site against the generated deployment metadata", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const verify = jobBlock(workflow, "verify").replaceAll(/\s+/gu, " ");

    expect(verify).toMatch(/run:\s*node packages\/catalogue-snapshot\/dist\/verify-entry\.js/u);
    expect(verify).toMatch(/--base-url\s+"\$\{\{\s*needs\.deploy\.outputs\.page-url\s*\}\}"/u);
    expect(verify).toMatch(
      /--expected-sha256\s+"\$\{\{\s*needs\.generate\.outputs\.sha256\s*\}\}"/u,
    );
    expect(verify).toMatch(
      /--expected-generated-at\s+"\$\{\{\s*needs\.generate\.outputs\.generated-at\s*\}\}"/u,
    );
  });

  it("pins every action to an immutable 40-character commit", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const actions = [...workflow.matchAll(/^\s+- (?:id: [^\n]+\n\s+)?uses: ([^\s]+)$/gmu)].map(
      ([, action]) => action,
    );

    expect(actions).toEqual([
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b",
      "actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b",
      "actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    ]);
    expect(actions.every((action) => /@[a-f0-9]{40}$/u.test(action))).toBe(true);
  });
});

function topLevelBlock(workflow: string, name: string): string {
  return indentedBlock(workflow, `${name}:\n`, 0);
}

function jobNames(workflow: string): string[] {
  return [...topLevelBlock(workflow, "jobs").matchAll(/^ {2}([a-z][a-z0-9-]*):$/gmu)].map(
    ([, name]) => name,
  );
}

function jobBlock(workflow: string, name: string): string {
  return indentedBlock(topLevelBlock(workflow, "jobs"), `  ${name}:\n`, 2);
}

function jobSettingBlock(job: string, name: string): string {
  return indentedBlock(job, `    ${name}:\n`, 4);
}

function jobStepBlock(job: string, id: string): string {
  return indentedBlock(job, `      - id: ${id}\n`, 6);
}

function yamlValue(source: string, name: string): string | undefined {
  const prefix = `${name}:`;
  return source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

function expressionValue(source: string, name: string): string | undefined {
  return yamlValue(source, name)?.replaceAll(/\s+/gu, "");
}

function indentedBlock(source: string, marker: string, indent: number): string {
  const start = source.indexOf(marker);
  expect(start, `missing ${marker.trim()}`).toBeGreaterThanOrEqual(0);
  const bodyStart = start + marker.length;
  const remainder = source.slice(bodyStart);
  const next = remainder.search(new RegExp(`^ {${indent}}\\S`, "mu"));
  return next === -1 ? remainder : remainder.slice(0, next);
}

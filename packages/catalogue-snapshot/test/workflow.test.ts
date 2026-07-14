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
    expect(jobSettingBlock(generate, "permissions")).toBe("      contents: read\n");
    expect(jobSettingBlock(deploy, "permissions")).toBe("      contents: read\n");
    expect(jobSettingBlock(verify, "permissions")).toBe("      contents: read\n");
    expect(deploy).toContain("    needs: generate");
    expect(verify).toContain("    needs: [generate, deploy]");
    expect(workflow).not.toContain("pages: write");
    expect(workflow).not.toContain("id-token: write");
  });

  it("publishes only the generated catalogue to the public user-site branch", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const generate = jobBlock(workflow, "generate");
    const deploy = jobBlock(workflow, "deploy");

    expect(generate).toContain("          name: catalogue-site");
    expect(generate).toContain("          path: site");
    expect(generate).toContain("          retention-days: 2");
    expect(deploy).toContain("          name: catalogue-site");
    expect(deploy).toContain("          path: publish/opsi");
    expect(deploy).toContain("CATALOGUE_DEPLOY_KEY: ${{ secrets.CATALOGUE_DEPLOY_KEY }}");
    expect(deploy).toContain("git@github.com:0xfa7ca7/0xfa7ca7.github.io.git");
    expect(deploy).toContain("git checkout --orphan gh-pages");
    expect(deploy).toContain("git add --all -- opsi");
    expect(deploy).toContain("git push --force origin HEAD:gh-pages");
    expect(deploy).toContain(
      "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
    );
    expect(deploy).not.toContain("ssh-keyscan");
    expect(deploy).toContain('chmod 0600 "$KEY_FILE"');
    expect(deploy).toContain('rm -f "$RUNNER_TEMP/catalogue-ssh/id_ed25519"');
    expect(deploy).toContain("if: ${{ always() }}");
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

  it("retries bounded verification of the public site against the generated metadata", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const verify = jobBlock(workflow, "verify").replaceAll(/\s+/gu, " ");

    expect(verify).toMatch(/node packages\/catalogue-snapshot\/dist\/verify-entry\.js/u);
    expect(verify).toMatch(/for attempt in \$\(seq 1 12\)/u);
    expect(verify).toMatch(/--base-url\s+"https:\/\/0xfa7ca7\.github\.io\/opsi\/"/u);
    expect(verify).toMatch(
      /--expected-sha256\s+"\$\{\{\s*needs\.generate\.outputs\.sha256\s*\}\}"/u,
    );
    expect(verify).toMatch(
      /--expected-generated-at\s+"\$\{\{\s*needs\.generate\.outputs\.generated-at\s*\}\}"/u,
    );
    expect(verify).toMatch(/test "\$attempt" -eq 12/u);
    expect(verify).toContain("sleep 10");
  });

  it("pins every action to an immutable 40-character commit", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const actions = [...workflow.matchAll(/^\s+- (?:id: [^\n]+\n\s+)?uses: ([^\s]+)$/gmu)].map(
      ([, action]) => action,
    );

    expect(actions).toEqual([
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
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

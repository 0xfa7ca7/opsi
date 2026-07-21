import { describe, expect, it } from "vitest";
import {
  agentDisplayName,
  renderAgentSetupConfirmation,
  renderAgentSetupResult,
} from "../src/agent-setup-presentation.js";
import { renderOnboarding } from "../src/onboarding.js";
import { createPresentation } from "../src/presentation.js";

describe("terminal presentation", () => {
  it("applies semantic styling only when color is enabled", () => {
    expect(createPresentation({ color: true }).heading("Get started")).toContain("\u001b[");
    expect(createPresentation({ color: false }).heading("Get started")).toBe("Get started");
  });

  it("sanitizes terminal control sequences in dynamic text", () => {
    expect(createPresentation({ color: false }).sanitize("bad\u001b[31m")).toBe("bad\\u001b[31m");
  });
});

describe("bare-command onboarding", () => {
  it("guides users through first steps and agent setup in plain text", () => {
    const output = renderOnboarding(createPresentation({ color: false }));

    expect(output).toContain("KLOPSI");
    expect(output).toContain("Discover and work with Slovenian public data");
    expect(output).toContain("Get started");
    expect(output).toContain("Use KLOPSI with your AI agent");
    expect(output).toContain("klopsi agent setup");
    expect(output).toContain("klopsi --help");
    expect(output).toContain("klopsi doctor");
    expect(output).toContain("klopsi providers list");
    expect(output).not.toContain("\u001b[");
    expect(output).toMatch(/[^\n]\n$/u);
  });
});

describe("agent setup presentation", () => {
  const presentation = createPresentation({ color: false });
  const skills = Array.from({ length: 11 }, (_, index) => `skill-${index + 1}`);

  it("uses readable product names and sanitizes unknown agent IDs", () => {
    expect(agentDisplayName("openclaw")).toBe("OpenClaw");
    expect(agentDisplayName("codex")).toBe("Codex");
    expect(agentDisplayName("cursor")).toBe("Cursor");
    expect(agentDisplayName("github-copilot")).toBe("GitHub Copilot");
    expect(agentDisplayName("claude-code")).toBe("Claude Code");

    const fallback = agentDisplayName("future-agent\u001b[31m");
    expect(fallback).toContain("Future Agent");
    expect(fallback).not.toContain("\u001b[");
    expect(fallback).toContain("\\u001b[31m");
  });

  it("previews detected agents and repertoire size before confirmation", () => {
    const output = renderAgentSetupConfirmation(
      ["openclaw", "codex", "cursor", "github-copilot"],
      11,
      presentation,
    );

    expect(output).toContain("KLOPSI agent setup");
    expect(output).toContain("Detected agents");
    expect(output).toContain("OpenClaw");
    expect(output).toContain("Codex");
    expect(output).toContain("Cursor");
    expect(output).toContain("GitHub Copilot");
    expect(output).toContain("11 KLOPSI skills");
  });

  it("summarizes a successful installation with next steps", () => {
    const output = renderAgentSetupResult(
      {
        installer: "skills@1.5.19",
        scope: "global",
        selection: "detected",
        skills,
        agents: ["openclaw", "codex", "cursor", "github-copilot"],
        dryRun: false,
      },
      presentation,
    );

    expect(output).toContain("KLOPSI agent setup complete");
    expect(output).toContain("Installed for");
    expect(output).toContain("OpenClaw");
    expect(output).toContain("GitHub Copilot");
    expect(output).toContain("Skills installed");
    expect(output).toContain("11 KLOPSI skills");
    expect(output).toContain("Installer");
    expect(output).toContain("skills@1.5.19");
    expect(output).toContain("Scope");
    expect(output).toContain("Global");
    expect(output).toContain("Next steps");
    expect(output).toContain("klopsi agent setup --dry-run");
    expect(output).not.toContain("skill-1");
  });

  it("makes a detected-selection dry run explicit and actionable", () => {
    const output = renderAgentSetupResult(
      {
        installer: "skills@1.5.19",
        scope: "global",
        selection: "detected",
        skills,
        agents: [],
        dryRun: true,
      },
      presentation,
    );

    expect(output).toContain("Setup preview");
    expect(output).toContain("No files will be changed");
    expect(output).toContain("Detected agents will be selected during installation");
    expect(output).toContain("11 KLOPSI skills");
    expect(output).toContain("klopsi agent setup --yes");
  });
});

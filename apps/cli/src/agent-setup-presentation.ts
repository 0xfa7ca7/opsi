import { sanitizeTerminalText } from "@klopsi/output";
import type { AgentSetupResult } from "./agent-setup.js";
import type { Presentation } from "./presentation.js";

const SPECIAL_NAMES: Readonly<Record<string, string>> = {
  openclaw: "OpenClaw",
  codex: "Codex",
  cursor: "Cursor",
  "github-copilot": "GitHub Copilot",
  "claude-code": "Claude Code",
  "gemini-cli": "Gemini CLI",
  "antigravity-cli": "Antigravity CLI",
  opencode: "OpenCode",
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function agentDisplayName(id: string): string {
  const special = SPECIAL_NAMES[id];
  if (special !== undefined) return special;

  return sanitizeTerminalText(id)
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function agentList(agents: readonly string[], presentation: Presentation): readonly string[] {
  return agents.map((agent) => `  • ${presentation.sanitize(agentDisplayName(agent))}`);
}

function setupCommand(result: AgentSetupResult): string {
  if (result.selection === "detected") return "klopsi agent setup --yes";
  if (result.selection === "all") return "klopsi agent setup --all --yes";
  return `klopsi agent setup --agent ${result.selection.join(" ")} --yes`;
}

function selectionLabel(selection: AgentSetupResult["selection"]): string {
  if (selection === "detected") return "Detected agents";
  if (selection === "all") return "All supported agents";
  return "Explicit agents";
}

function renderDryRun(result: AgentSetupResult, presentation: Presentation): string {
  const targetLines =
    result.selection === "detected"
      ? ["  Detected agents will be selected during installation."]
      : result.selection === "all"
        ? ["  Every supported globally installable agent will be targeted."]
        : agentList(result.agents, presentation);

  return [
    presentation.title("Setup preview"),
    presentation.muted("No files will be changed."),
    "",
    presentation.heading("Targeting"),
    ...targetLines,
    "",
    presentation.heading("Skills"),
    `  ${result.skills.length} KLOPSI ${plural(result.skills.length, "skill")} will be installed globally.`,
    "",
    presentation.heading("Run setup"),
    `  ${presentation.command(setupCommand(result))}`,
    "",
  ].join("\n");
}

function renderSuccess(result: AgentSetupResult, presentation: Presentation): string {
  return [
    presentation.success("✓ KLOPSI agent setup complete"),
    "",
    presentation.heading("Installed for"),
    ...agentList(result.agents, presentation),
    "",
    presentation.heading("Skills installed"),
    `  ${result.skills.length} KLOPSI ${plural(result.skills.length, "skill")}`,
    "  Catalogue discovery, downloads, validation, analysis, services,",
    "  provenance, local state, and diagnostics are ready to use.",
    "",
    presentation.heading("Details"),
    `  Installer   ${presentation.sanitize(result.installer)}`,
    "  Scope       Global",
    `  Selection   ${selectionLabel(result.selection)}`,
    "",
    presentation.heading("Next steps"),
    "  Restart or reload your agent so it discovers the new skills.",
    '  Then ask: "Find Slovenian public data about population with KLOPSI."',
    "",
    "  Preview future updates:",
    `  ${presentation.command("klopsi agent setup --dry-run")}`,
    "",
  ].join("\n");
}

export function renderAgentSetupConfirmation(
  agents: readonly string[],
  skillCount: number,
  presentation: Presentation,
): string {
  return [
    presentation.title("KLOPSI agent setup"),
    "",
    presentation.heading("Detected agents"),
    ...agentList(agents, presentation),
    "",
    `  ${skillCount} KLOPSI ${plural(skillCount, "skill")} will be installed globally.`,
    "",
  ].join("\n");
}

export function renderAgentSetupResult(
  result: AgentSetupResult,
  presentation: Presentation,
): string {
  return result.dryRun ? renderDryRun(result, presentation) : renderSuccess(result, presentation);
}

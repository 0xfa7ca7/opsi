import type { Presentation } from "./presentation.js";

export function renderOnboarding(presentation: Presentation): string {
  return [
    presentation.title("KLOPSI"),
    presentation.muted("Discover and work with Slovenian public data"),
    "",
    presentation.heading("Get started"),
    "  1. Search the public-data catalogue",
    `     ${presentation.command('klopsi search "population"')}`,
    "",
    "  2. Inspect a dataset",
    `     ${presentation.command("klopsi dataset show <id>")}`,
    "",
    presentation.heading("Use KLOPSI with your AI agent"),
    "  Install the complete KLOPSI skill repertoire for detected agents:",
    `  ${presentation.command("klopsi agent setup")}`,
    "",
    presentation.heading("Explore"),
    `  ${presentation.command("klopsi --help")}          Full command reference`,
    `  ${presentation.command("klopsi doctor")}          Check your environment`,
    `  ${presentation.command("klopsi providers list")}  List available data providers`,
    "",
  ].join("\n");
}

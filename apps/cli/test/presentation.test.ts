import { describe, expect, it } from "vitest";
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

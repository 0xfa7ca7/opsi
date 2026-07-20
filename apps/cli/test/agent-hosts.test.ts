import { describe, expect, it, vi } from "vitest";
import { PINNED_GLOBAL_AGENT_IDS, PinnedAgentHostRegistry } from "../src/agent-hosts.js";

describe("pinned agent host registry", () => {
  it("tracks every globally installable profile in skills 1.5.19", () => {
    expect(PINNED_GLOBAL_AGENT_IDS).toHaveLength(71);
    expect(PINNED_GLOBAL_AGENT_IDS).toEqual(
      expect.arrayContaining(["claude-code", "codex", "gemini-cli", "cursor", "universal"]),
    );
    expect(PINNED_GLOBAL_AGENT_IDS).not.toEqual(expect.arrayContaining(["eve", "promptscript"]));
  });

  it("detects home, environment-specific, config, and project-local host markers", async () => {
    const existing = new Set([
      "/test/home/.claude-custom",
      "/test/home/.codex-custom",
      "/test/config/opencode",
      "/workspace/.codebuddy",
    ]);
    const pathExists = vi.fn(async (path: string) => existing.has(path));
    const registry = new PinnedAgentHostRegistry({ pathExists });

    await expect(
      registry.detect({
        cwd: "/workspace",
        home: "/test/home",
        env: {
          CLAUDE_CONFIG_DIR: "/test/home/.claude-custom",
          CODEX_HOME: "/test/home/.codex-custom",
          XDG_CONFIG_HOME: "/test/config",
        },
      }),
    ).resolves.toEqual(["claude-code", "codebuddy", "codex", "opencode"]);
  });

  it("returns an empty selection when no supported host marker exists", async () => {
    const registry = new PinnedAgentHostRegistry({ pathExists: async () => false });

    await expect(
      registry.detect({ cwd: "/workspace", home: "/home/user", env: {} }),
    ).resolves.toEqual([]);
  });
});

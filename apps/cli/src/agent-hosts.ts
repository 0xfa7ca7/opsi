import { access } from "node:fs/promises";
import { join } from "node:path";

// Keep this registry synchronized with the globally installable profiles in skills@1.5.19.
// Eve and PromptScript are intentionally excluded because the pinned installer declares no
// global skill directory for them.
export const PINNED_GLOBAL_AGENT_IDS = [
  "aider-desk",
  "amp",
  "antigravity",
  "antigravity-cli",
  "astrbot",
  "autohand-code",
  "augment",
  "bob",
  "claude-code",
  "openclaw",
  "cline",
  "codearts-agent",
  "codebuddy",
  "codemaker",
  "codestudio",
  "codex",
  "command-code",
  "continue",
  "cortex",
  "crush",
  "cursor",
  "deepagents",
  "devin",
  "dexto",
  "droid",
  "firebender",
  "forgecode",
  "gemini-cli",
  "github-copilot",
  "goose",
  "hermes-agent",
  "inference-sh",
  "jazz",
  "junie",
  "iflow-cli",
  "kilo",
  "kimi-code-cli",
  "kiro-cli",
  "kode",
  "lingma",
  "loaf",
  "mcpjam",
  "mistral-vibe",
  "moxby",
  "mux",
  "opencode",
  "openhands",
  "ona",
  "pi",
  "qoder",
  "qoder-cn",
  "qwen-code",
  "replit",
  "reasonix",
  "rovodev",
  "roo",
  "tabnine-cli",
  "terramind",
  "tinycloud",
  "trae",
  "trae-cn",
  "warp",
  "windsurf",
  "zed",
  "zcode",
  "zencoder",
  "zenflow",
  "neovate",
  "pochi",
  "adal",
  "universal",
] as const;

export type PinnedGlobalAgentId = (typeof PINNED_GLOBAL_AGENT_IDS)[number];

export interface AgentHostDetectionContext {
  readonly cwd: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface AgentHostRegistry {
  readonly supportedAgentIds: readonly string[];
  detect(context: AgentHostDetectionContext): Promise<readonly string[]>;
}

export type AgentMarkerExists = (path: string) => Promise<boolean>;

export interface PinnedAgentHostRegistryOptions {
  readonly pathExists?: AgentMarkerExists;
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function configuredHome(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? fallback : trimmed;
}

function markers(id: PinnedGlobalAgentId, context: AgentHostDetectionContext): readonly string[] {
  const { cwd, env, home } = context;
  const configHome = configuredHome(env.XDG_CONFIG_HOME, join(home, ".config"));
  switch (id) {
    case "aider-desk":
      return [join(home, ".aider-desk")];
    case "amp":
      return [join(configHome, "amp")];
    case "antigravity":
      return [join(home, ".gemini", "antigravity")];
    case "antigravity-cli":
      return [join(home, ".gemini", "antigravity-cli")];
    case "astrbot":
      return [join(cwd, "data", "skills"), join(home, ".astrbot")];
    case "autohand-code":
      return [configuredHome(env.AUTOHAND_HOME, join(home, ".autohand"))];
    case "augment":
      return [join(home, ".augment")];
    case "bob":
      return [join(home, ".bob")];
    case "claude-code":
      return [configuredHome(env.CLAUDE_CONFIG_DIR, join(home, ".claude"))];
    case "openclaw":
      return [join(home, ".openclaw"), join(home, ".clawdbot"), join(home, ".moltbot")];
    case "cline":
      return [join(home, ".cline")];
    case "codearts-agent":
      return [join(home, ".codeartsdoer")];
    case "codebuddy":
      return [join(cwd, ".codebuddy"), join(home, ".codebuddy")];
    case "codemaker":
      return [join(home, ".codemaker")];
    case "codestudio":
      return [join(home, ".codestudio")];
    case "codex":
      return [configuredHome(env.CODEX_HOME, join(home, ".codex")), "/etc/codex"];
    case "command-code":
      return [join(home, ".commandcode")];
    case "continue":
      return [join(cwd, ".continue"), join(home, ".continue")];
    case "cortex":
      return [join(home, ".snowflake", "cortex")];
    case "crush":
      return [join(home, ".config", "crush")];
    case "cursor":
      return [join(home, ".cursor")];
    case "deepagents":
      return [join(home, ".deepagents")];
    case "devin":
      return [join(configHome, "devin")];
    case "dexto":
      return [join(home, ".dexto")];
    case "droid":
      return [join(home, ".factory")];
    case "firebender":
      return [join(home, ".firebender")];
    case "forgecode":
      return [join(home, ".forge")];
    case "gemini-cli":
      return [join(home, ".gemini")];
    case "github-copilot":
      return [join(home, ".copilot")];
    case "goose":
      return [join(configHome, "goose")];
    case "hermes-agent":
      return [configuredHome(env.HERMES_HOME, join(home, ".hermes"))];
    case "inference-sh":
      return [join(home, ".inferencesh")];
    case "jazz":
      return [join(home, ".jazz"), join(cwd, ".jazz")];
    case "junie":
      return [join(home, ".junie")];
    case "iflow-cli":
      return [join(home, ".iflow")];
    case "kilo":
      return [join(home, ".kilocode")];
    case "kimi-code-cli":
      return [join(home, ".kimi-code"), join(home, ".kimi")];
    case "kiro-cli":
      return [join(home, ".kiro")];
    case "kode":
      return [join(home, ".kode")];
    case "lingma":
      return [join(home, ".lingma")];
    case "loaf":
      return [join(home, ".loaf")];
    case "mcpjam":
      return [join(home, ".mcpjam")];
    case "mistral-vibe":
      return [configuredHome(env.VIBE_HOME, join(home, ".vibe"))];
    case "moxby":
      return [join(home, ".moxby")];
    case "mux":
      return [join(home, ".mux")];
    case "opencode":
      return [join(configHome, "opencode")];
    case "openhands":
      return [join(home, ".openhands")];
    case "ona":
      return [join(home, ".ona")];
    case "pi":
      return [join(home, ".pi", "agent")];
    case "qoder":
      return [join(home, ".qoder")];
    case "qoder-cn":
      return [join(home, ".qoder-cn")];
    case "qwen-code":
      return [join(home, ".qwen")];
    case "replit":
      return [join(cwd, ".replit")];
    case "reasonix":
      return [join(home, ".reasonix")];
    case "rovodev":
      return [join(home, ".rovodev")];
    case "roo":
      return [join(home, ".roo")];
    case "tabnine-cli":
      return [join(home, ".tabnine")];
    case "terramind":
      return [join(home, ".terramind")];
    case "tinycloud":
      return [join(home, ".tinycloud")];
    case "trae":
      return [join(home, ".trae")];
    case "trae-cn":
      return [join(home, ".trae-cn")];
    case "warp":
      return [join(home, ".warp")];
    case "windsurf":
      return [join(home, ".codeium", "windsurf")];
    case "zed": {
      const appData = env.APPDATA?.trim();
      const flatpakConfig = env.FLATPAK_XDG_CONFIG_HOME?.trim();
      return [
        join(configHome, "zed"),
        ...(appData === undefined || appData.length === 0 ? [] : [join(appData, "Zed")]),
        ...(flatpakConfig === undefined || flatpakConfig.length === 0
          ? []
          : [join(flatpakConfig, "zed")]),
      ];
    }
    case "zcode":
      return [join(home, ".zcode"), "/Applications/ZCode.app"];
    case "zencoder":
    case "zenflow":
      return [join(home, ".zencoder")];
    case "neovate":
      return [join(home, ".neovate")];
    case "pochi":
      return [join(home, ".pochi")];
    case "adal":
      return [join(home, ".adal")];
    case "universal":
      return [];
  }
}

export class PinnedAgentHostRegistry implements AgentHostRegistry {
  readonly supportedAgentIds = PINNED_GLOBAL_AGENT_IDS;
  readonly #pathExists: AgentMarkerExists;

  constructor(options: PinnedAgentHostRegistryOptions = {}) {
    this.#pathExists = options.pathExists ?? defaultPathExists;
  }

  async detect(context: AgentHostDetectionContext): Promise<readonly string[]> {
    const detected = await Promise.all(
      PINNED_GLOBAL_AGENT_IDS.map(async (id) => ({
        id,
        installed: (await Promise.all(markers(id, context).map(this.#pathExists))).some(Boolean),
      })),
    );
    return detected.filter((entry) => entry.installed).map((entry) => entry.id);
  }
}

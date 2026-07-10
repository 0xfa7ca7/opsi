export interface CommandOptionManifest {
  readonly flags: string;
  readonly choices?: readonly string[];
}

export interface CommandManifestEntry {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CommandOptionManifest[];
  readonly commands?: readonly CommandManifestEntry[];
}

export const GLOBAL_OPTION_MANIFEST: readonly CommandOptionManifest[] = [
  { flags: "--json" },
  { flags: "--ndjson" },
  { flags: "--csv" },
  { flags: "--tsv" },
  { flags: "--output-format <format>", choices: ["table", "json", "ndjson", "csv", "tsv"] },
  { flags: "--provider <id>", choices: ["opsi", "local"] },
  { flags: "--offline" },
  { flags: "--no-color" },
  { flags: "--quiet" },
  { flags: "--debug" },
] as const;

export const COMMAND_MANIFEST: readonly CommandManifestEntry[] = [
  {
    name: "search",
    description: "Search datasets",
    options: [{ flags: "--limit <number>" }, { flags: "--offset <number>" }],
  },
  {
    name: "dataset",
    description: "Inspect datasets",
    commands: [
      { name: "show", description: "Show dataset details" },
      { name: "resources", description: "List dataset resources" },
      {
        name: "schema",
        description: "Infer a dataset schema",
        options: [{ flags: "--resource <id>" }, { flags: "--sheet <name>" }],
      },
      { name: "open", description: "Open the public dataset page" },
    ],
  },
  {
    name: "resource",
    description: "Inspect resources",
    commands: [
      { name: "show", description: "Show resource details" },
      {
        name: "preview",
        description: "Preview bounded rows",
        options: [{ flags: "--limit <rows>" }, { flags: "--sheet <name>" }],
      },
      { name: "headers", description: "Probe resource headers" },
    ],
  },
  {
    name: "download",
    description: "Download resources",
    options: [
      { flags: "--destination <path>" },
      { flags: "--output <path>" },
      { flags: "--force" },
    ],
  },
  {
    name: "query",
    description: "Run a sandboxed query",
    options: [
      { flags: "--sql <query>" },
      { flags: "--limit <rows>" },
      { flags: "--output <path>" },
    ],
  },
  {
    name: "convert",
    description: "Convert tabular data",
    options: [
      { flags: "--to <format>", choices: ["csv", "tsv", "json", "ndjson", "xlsx", "parquet"] },
      { flags: "--output <path>" },
    ],
  },
  { name: "validate", description: "Validate data or metadata" },
  {
    name: "provenance",
    description: "Inspect provenance",
    commands: [
      { name: "show", description: "Show provenance" },
      { name: "verify", description: "Verify provenance" },
    ],
  },
  {
    name: "providers",
    description: "Inspect providers",
    commands: [{ name: "list", description: "List providers" }],
  },
  {
    name: "cache",
    description: "Maintain the cache",
    commands: ["info", "list", "clear", "prune", "verify"].map((name) => ({
      name,
      description: `${name} cache`,
      ...(["clear", "prune"].includes(name) ? { options: [{ flags: "--yes" }] } : {}),
    })),
  },
  {
    name: "config",
    description: "Inspect and update configuration",
    commands: ["get", "set", "list", "path"].map((name) => ({
      name,
      description: `${name} configuration`,
    })),
  },
  {
    name: "doctor",
    description: "Run installation diagnostics",
    options: [{ flags: "--offline" }],
  },
  {
    name: "completion",
    description: "Generate shell completion",
    options: [{ flags: "<shell>", choices: ["bash", "zsh", "fish"] }],
  },
] as const;

export function commandWords(): readonly string[] {
  return COMMAND_MANIFEST.flatMap((entry) => [
    entry.name,
    ...(entry.commands?.map((child) => child.name) ?? []),
  ]);
}

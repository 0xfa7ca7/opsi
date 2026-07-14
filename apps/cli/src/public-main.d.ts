export interface CliIo {
  readonly cwd?: string;
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdout: { readonly isTTY?: boolean; write(chunk: string): unknown };
  readonly stderr: { readonly isTTY?: boolean; write(chunk: string): unknown };
  readonly stdin?: { readonly isTTY?: boolean };
  readonly confirm?: (message: string) => Promise<boolean>;
}
export interface CliContext {
  readonly io: CliIo;
  readonly version: string;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly renderer?: { write(data: unknown, meta?: Readonly<Record<string, unknown>>): void };
  readonly openUrl?: (url: string) => Promise<void>;
}
export interface ProgramDependencies {
  readonly catalogue?: {
    list(options?: { readonly refresh?: boolean }): Promise<{
      readonly datasets: readonly {
        readonly id: string;
        readonly title: string;
        readonly name: string;
      }[];
      readonly generatedAt: string;
      readonly source: "snapshot-cache" | "snapshot-remote";
    }>;
  };
}
export declare function createProgram(
  context: CliContext,
  dependencies?: ProgramDependencies,
): unknown;
export declare function readPackageVersion(packageUrl?: URL): string;
export declare const VERSION: string;
export declare function runCli(
  argv: readonly string[],
  io: CliIo,
): Promise<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8>;

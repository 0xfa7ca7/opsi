import { ConfigStore, resolveConfigPaths } from "@opsi/config";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

function atPath(source: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)[part]
          : undefined,
      source,
    );
}

function configValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function registerConfigCommand(program: Command, context: CliContext): void {
  const paths = resolveConfigPaths({
    ...(context.io.cwd === undefined ? {} : { cwd: context.io.cwd }),
    ...(context.io.home === undefined ? {} : { home: context.io.home }),
  });
  const store = new ConfigStore(paths.userFile);
  manifestCommand(program, "config get").action(async (key: string) => {
    context.renderer?.write({ key, value: atPath(await store.read(), key) });
  });
  manifestCommand(program, "config set").action(async (key: string, value: string) => {
    const parsed = configValue(value);
    await store.set(key, parsed);
    context.renderer?.write({ key, value: parsed });
  });
  manifestCommand(program, "config list").action(async () =>
    context.renderer?.write(await store.read()),
  );
  manifestCommand(program, "config path").action(() =>
    context.renderer?.write({ user: paths.userFile, project: paths.projectFile }),
  );
}

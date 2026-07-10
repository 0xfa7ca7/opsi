import envPaths from "env-paths";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export interface ConfigPaths {
  readonly projectFile: string;
  readonly userFile: string;
  readonly cacheDir: string;
  readonly dataDir: string;
  readonly downloadDir: string;
}

export interface ResolveConfigPathsOptions {
  readonly cwd?: string;
  readonly home?: string;
}

function relocateHome(path: string, home: string | undefined): string {
  if (home === undefined) return path;
  const systemHome = homedir();
  const suffix = relative(systemHome, path);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix))
    ? resolve(home, suffix)
    : path;
}

export function resolveConfigPaths(options: ResolveConfigPathsOptions = {}): ConfigPaths {
  const roots = envPaths("opsi", { suffix: "" });
  const cwd = options.cwd ?? process.cwd();
  const configDir = relocateHome(roots.config, options.home);
  const cacheDir = relocateHome(roots.cache, options.home);
  const dataDir = relocateHome(roots.data, options.home);

  return {
    projectFile: join(cwd, "opsi.config.json"),
    userFile: join(configDir, "opsi.config.json"),
    cacheDir,
    dataDir,
    downloadDir: join(dataDir, "downloads"),
  };
}

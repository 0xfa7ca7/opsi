import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import {
  invalidConfiguration,
  parseConfigurationSource,
  type ConfigurationSource,
} from "./schema.js";

const SECRET_KEY = /(?:apiKey|token|secret|authorization|cookie)/iu;

function secretKeyError(key: string): KlopsiError {
  return new KlopsiError({
    code: "SECRET_CONFIGURATION_KEY",
    message: `The configuration key ${key} is secret-like and cannot be persisted.`,
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Provide secrets through the environment for the current process.",
  });
}

function assertSafeKey(key: string): void {
  if (SECRET_KEY.test(key)) throw secretKeyError(key);
  if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/u.test(key)) {
    throw invalidConfiguration(new Error(`Invalid configuration key: ${key}`));
  }
}

function setPath(target: Record<string, unknown>, parts: readonly string[], value: unknown): void {
  const [head, ...tail] = parts;
  if (head === undefined) return;
  if (tail.length === 0) {
    target[head] = value;
    return;
  }
  const existing = target[head];
  const child =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  target[head] = child;
  setPath(child, tail, value);
}

function deletePath(target: Record<string, unknown>, parts: readonly string[]): void {
  const [head, ...tail] = parts;
  if (head === undefined) return;
  if (tail.length === 0) {
    delete target[head];
    return;
  }
  const existing = target[head];
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return;
  const child = { ...(existing as Record<string, unknown>) };
  deletePath(child, tail);
  if (Object.keys(child).length === 0) delete target[head];
  else target[head] = child;
}

export class ConfigStore {
  constructor(readonly file: string) {}

  async read(): Promise<ConfigurationSource> {
    try {
      return parseConfigurationSource(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      if (error instanceof KlopsiError) throw error;
      throw invalidConfiguration(error);
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    assertSafeKey(key);
    const source: Record<string, unknown> = { ...(await this.read()) };
    setPath(source, key.split("."), value);
    await this.write(parseConfigurationSource(source));
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const source: Record<string, unknown> = { ...(await this.read()) };
    deletePath(source, key.split("."));
    await this.write(parseConfigurationSource(source));
  }

  private async write(source: ConfigurationSource): Promise<void> {
    const directory = dirname(this.file);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(source, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

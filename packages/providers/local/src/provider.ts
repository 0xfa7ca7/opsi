import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { EXIT_CODES, OpsiError, localFileReference, type CanonicalReference } from "@opsi/domain";

export interface LocalFile {
  readonly path: string;
  readonly reference: CanonicalReference;
  readonly sizeBytes: number;
}

export class LocalProvider {
  private readonly cwd: string;

  constructor(options: { readonly cwd?: string } = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  async resolve(input: string): Promise<LocalFile> {
    const requested = input.startsWith("local:file:") ? input.slice("local:file:".length) : input;
    const absolute = resolve(this.cwd, requested);
    let details;
    try {
      details = await stat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new OpsiError({
          code: "LOCAL_FILE_NOT_FOUND",
          message: `Local file not found: ${absolute}`,
          exitCode: EXIT_CODES.NOT_FOUND,
          context: { path: absolute },
        });
      throw error;
    }
    if (!details.isFile())
      throw new OpsiError({
        code: "LOCAL_FILE_NOT_REGULAR",
        message: `Local input is not a regular file: ${absolute}`,
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { path: absolute },
      });
    return { path: absolute, reference: localFileReference(absolute), sizeBytes: details.size };
  }
}

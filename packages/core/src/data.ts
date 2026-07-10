import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataEngine, type DataInput, type PreviewOptions } from "@opsi/data-engine";
import {
  EXIT_CODES,
  OpsiError,
  parseCanonicalReference,
  resourceId,
  type ResourceId,
} from "@opsi/domain";
import { LocalProvider } from "@opsi/provider-local";
import type { OpsiClient } from "./client.js";

export interface DataResolutionOptions {
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
}

export interface DataOperationOptions extends PreviewOptions, DataResolutionOptions {}

export class DataService {
  private readonly local: LocalProvider;

  constructor(
    private readonly client: OpsiClient,
    private readonly engine: DataEngine = new DataEngine(),
    options: { readonly cwd?: string } = {},
  ) {
    this.local = new LocalProvider(options);
  }

  private async withInput<T>(
    input: string,
    options: DataResolutionOptions,
    operation: (source: DataInput) => Promise<T>,
  ): Promise<T> {
    let id: ResourceId;
    if (input.startsWith("local:file:") || /^[^:]+:(?:dataset|resource):/u.test(input)) {
      const reference = parseCanonicalReference(input);
      if (reference.kind === "file") return operation(await this.local.resolve(input));
      if (reference.kind !== "resource")
        throw new OpsiError({
          code: "RESOURCE_REFERENCE_REQUIRED",
          message: "This data operation requires a resource or local file reference.",
          exitCode: EXIT_CODES.INVALID_INPUT,
          suggestion: "Select a dataset resource first.",
        });
      id = reference.id;
    } else {
      try {
        return await operation(await this.local.resolve(input));
      } catch (error) {
        if (!(error instanceof OpsiError) || error.code !== "LOCAL_FILE_NOT_FOUND") throw error;
      }
      id = resourceId(input);
    }
    if (this.client.downloads === undefined)
      throw new OpsiError({
        code: "DOWNLOAD_SERVICE_UNAVAILABLE",
        message: "Resource data cannot be resolved because downloads are unavailable.",
        exitCode: EXIT_CODES.UNSUPPORTED,
      });
    const resource = await this.client.resources.get(id);
    const directory = await mkdtemp(join(tmpdir(), "opsi-data-"));
    try {
      const downloaded = await this.client.downloads.resource(id, {
        destination: join(directory, "source"),
        allowInsecureHttp: options.allowInsecureHttp ?? false,
        allowPrivateNetwork: options.allowPrivateNetwork ?? false,
      });
      const mediaType = downloaded.mediaType ?? resource.mediaType;
      return await operation({
        path: downloaded.path,
        ...(mediaType === undefined ? {} : { mediaType }),
        ...(resource.format === undefined ? {} : { declaredFormat: resource.format }),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  inspect(input: string, options: DataResolutionOptions = {}) {
    return this.withInput(input, options, (source) => this.engine.inspect(source));
  }

  preview(input: string, options: DataOperationOptions = {}) {
    return this.withInput(input, options, (source) => this.engine.preview(source, options));
  }

  inferSchema(input: string, options: DataOperationOptions = {}) {
    return this.withInput(input, options, (source) => this.engine.inferSchema(source, options));
  }

  validate(input: string, options: DataOperationOptions = {}) {
    return this.withInput(input, options, (source) => this.engine.validate(source, options));
  }
}

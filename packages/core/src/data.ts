import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import {
  DEFAULT_ARCHIVE_LIMITS,
  DataEngine,
  detectFormat,
  extractArchiveEntry,
  inspectArchive,
  type ConversionResult,
  type DataInput,
  type PreviewOptions,
  type SupportedDataFormat,
} from "@opsi/data-engine";
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
  readonly entry?: string;
  readonly recordPath?: string;
}

export interface DataOperationOptions extends PreviewOptions, DataResolutionOptions {}

export interface DataConversionOptions extends DataResolutionOptions {
  readonly output: string;
  readonly targetFormat: SupportedDataFormat;
  readonly sheet?: string;
  readonly force?: boolean;
  readonly spreadsheetSafe?: boolean;
}

export class DataService {
  private readonly local: LocalProvider;

  constructor(
    private readonly client: OpsiClient,
    private readonly engine: DataEngine = new DataEngine(),
    options: { readonly cwd?: string } = {},
  ) {
    this.local = new LocalProvider(options);
  }

  async withResolvedInput<T>(
    input: string,
    options: DataResolutionOptions,
    operation: (source: DataInput) => Promise<T>,
  ): Promise<T> {
    let directory: string | undefined;
    const temporaryDirectory = async (): Promise<string> => {
      directory ??= await mkdtemp(join(tmpdir(), "opsi-data-"));
      return directory;
    };
    const prepare = async (source: DataInput): Promise<DataInput> => {
      const detection = await detectFormat(source);
      if (detection.format !== "zip") return source;
      let inspection;
      try {
        inspection = await inspectArchive(
          detection.path,
          DEFAULT_ARCHIVE_LIMITS,
          options.entry,
        );
      } catch (error) {
        if (error instanceof OpsiError && error.code === "ARCHIVE_ENTRY_REQUIRED") {
          const choices = (error.context?.choices as readonly string[] | undefined) ?? [];
          throw new OpsiError({
            code: error.code,
            message: error.message,
            exitCode: error.exitCode,
            ...(error.context === undefined ? {} : { context: error.context }),
            nextActions: choices.map((entry) => ({
              action: "resource.preview",
              argv: ["resource", "preview", input, "--entry", entry, "--json"],
            })),
          });
        }
        throw error;
      }
      const selected = inspection.selectedEntry as string;
      const output = join(await temporaryDirectory(), `entry${extname(basename(selected))}`);
      await extractArchiveEntry(detection.path, selected, output, DEFAULT_ARCHIVE_LIMITS);
      return {
        path: output,
        ...(typeof source === "string" || source.mediaType === undefined
          ? {}
          : { mediaType: source.mediaType }),
        declaredFormat: extname(selected).slice(1),
      };
    };
    const run = async (source: DataInput): Promise<T> => operation(await prepare(source));
    const runLocal = async (source: DataInput): Promise<T> => {
      try {
        return await run(source);
      } finally {
        if (directory !== undefined) await rm(directory, { recursive: true, force: true });
      }
    };
    let id: ResourceId;
    let selectedProviderId: string | undefined;
    if (input.startsWith("local:file:") || /^[^:]+:(?:dataset|resource):/u.test(input)) {
      const reference = parseCanonicalReference(input);
      if (reference.kind === "file") return runLocal(await this.local.resolve(input));
      if (reference.kind !== "resource")
        throw new OpsiError({
          code: "RESOURCE_REFERENCE_REQUIRED",
          message: "This data operation requires a resource or local file reference.",
          exitCode: EXIT_CODES.INVALID_INPUT,
          suggestion: "Select a dataset resource first.",
        });
      id = reference.id;
      selectedProviderId = reference.providerId;
    } else {
      try {
        return await runLocal(await this.local.resolve(input));
      } catch (error) {
        if (!(error instanceof OpsiError) || error.code !== "LOCAL_FILE_NOT_FOUND") throw error;
      }
      id = resourceId(input);
    }
    const resource = await this.client.resources.get(id, selectedProviderId);
    if (this.client.downloads === undefined)
      throw new OpsiError({
        code: "DOWNLOAD_SERVICE_UNAVAILABLE",
        message: "Resource data cannot be resolved because downloads are unavailable.",
        exitCode: EXIT_CODES.UNSUPPORTED,
      });
    directory = await temporaryDirectory();
    try {
      const downloaded = await this.client.downloads.resource(id, {
        ...(selectedProviderId === undefined ? {} : { providerId: selectedProviderId }),
        destination: join(directory, "source"),
        allowInsecureHttp: options.allowInsecureHttp ?? false,
        allowPrivateNetwork: options.allowPrivateNetwork ?? false,
        requireData: true,
      });
      const mediaType = downloaded.mediaType ?? resource.mediaType;
      return await run({
        path: downloaded.path,
        sha256: downloaded.sha256,
        ...(mediaType === undefined ? {} : { mediaType }),
        ...(resource.format === undefined ? {} : { declaredFormat: resource.format }),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  inspect(input: string, options: DataResolutionOptions = {}) {
    return this.withResolvedInput(input, options, (source) => this.engine.inspect(source));
  }

  preview(input: string, options: DataOperationOptions = {}) {
    return this.withResolvedInput(input, options, (source) => this.engine.preview(source, options));
  }

  inferSchema(input: string, options: DataOperationOptions = {}) {
    return this.withResolvedInput(input, options, (source) =>
      this.engine.inferSchema(source, options),
    );
  }

  validate(input: string, options: DataOperationOptions = {}) {
    return this.withResolvedInput(input, options, (source) =>
      this.engine.validate(source, options),
    );
  }

  convert(input: string, options: DataConversionOptions): Promise<ConversionResult> {
    return this.withResolvedInput(input, options, (source) =>
      this.engine.convert({
        input: source,
        output: options.output,
        targetFormat: options.targetFormat,
        ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
        ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
        force: options.force ?? false,
        spreadsheetSafe: options.spreadsheetSafe ?? false,
      }),
    );
  }
}

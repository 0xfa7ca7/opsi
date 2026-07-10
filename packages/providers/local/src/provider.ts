import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  EXIT_CODES,
  OpsiError,
  localFileReference,
  providerId,
  type CanonicalReference,
  type DataProvider,
  type Dataset,
  type ProviderDescriptor,
  type ResolvedResource,
  type Resource,
  type SearchPage,
} from "@opsi/domain";

export interface LocalFile {
  readonly path: string;
  readonly reference: CanonicalReference;
  readonly sizeBytes: number;
}

function unsupported(capability: string): OpsiError {
  return new OpsiError({
    code: "PROVIDER_CAPABILITY_UNSUPPORTED",
    message: `The local provider does not support ${capability}; use a local:file reference or path.`,
    exitCode: EXIT_CODES.UNSUPPORTED,
    context: { provider: "local", capability },
  });
}

export class LocalProvider implements DataProvider {
  readonly descriptor: ProviderDescriptor = {
    id: providerId("local"),
    name: "Local files",
    description: "Resolve local paths and local:file references",
    capabilities: ["resolve-resource"],
  };
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

  search(): Promise<SearchPage> {
    return Promise.reject(unsupported("catalog search"));
  }
  getDataset(): Promise<Dataset> {
    return Promise.reject(unsupported("dataset lookup"));
  }
  getResource(): Promise<Resource> {
    return Promise.reject(unsupported("resource lookup"));
  }
  listDatasetResources(): Promise<readonly Resource[]> {
    return Promise.reject(unsupported("dataset resource listing"));
  }
  async resolveResource(resource: Resource): Promise<ResolvedResource> {
    return { resource, kind: "file", url: resource.url };
  }
}

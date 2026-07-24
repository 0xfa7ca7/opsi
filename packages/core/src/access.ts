import { detectFormat, inspectArchive, type DetectedInputFormat } from "@klopsi/data-engine";
import {
  EXIT_CODES,
  KlopsiError,
  parseCanonicalReference,
  resourceId,
  type ResourceAccessDescriptor,
  type ResourceAccessOperation,
  type ResourceId,
} from "@klopsi/domain";
import { LocalProvider } from "@klopsi/provider-local";
import type { KlopsiClient } from "./client.js";
import type { ProviderRegistry } from "./registry.js";
import type { DataResolutionOptions } from "./data.js";

function action(name: string, argv: readonly string[], reason?: string) {
  return { action: name, argv, ...(reason === undefined ? {} : { reason }) };
}

function supportsDirectDataOperations(format: DetectedInputFormat): boolean {
  return format !== "zip" && format !== "unknown";
}

type ArchiveFailure =
  | { readonly kind: "selection"; readonly entries: readonly string[] }
  | { readonly kind: "selected-content" }
  | { readonly kind: "archive-content" };

const SELECTED_ARCHIVE_CONTENT_ERRORS = new Set([
  "INVALID_JSON",
  "INVALID_NDJSON",
  "INVALID_PCAXIS_DATA",
  "INVALID_TABULAR_DATA",
  "INVALID_XML_DATA",
  "PARSE_ERROR",
]);

function classifyArchiveFailure(error: unknown): ArchiveFailure | undefined {
  if (!(error instanceof KlopsiError)) return undefined;
  if (error.code === "ARCHIVE_ENTRY_REQUIRED")
    return {
      kind: "selection",
      entries: (error.context?.choices as readonly string[] | undefined) ?? [],
    };
  if (["INVALID_ARCHIVE_DATA", "ARCHIVE_NO_SUPPORTED_ENTRY"].includes(error.code))
    return { kind: "archive-content" };
  if (SELECTED_ARCHIVE_CONTENT_ERRORS.has(error.code) || error.code.startsWith("PCAXIS_"))
    return { kind: "selected-content" };
  return undefined;
}

function dataDescriptor(
  input: string,
  kind: "local" | "file" | "archive",
  format: DetectedInputFormat,
  options: {
    readonly selections?: Readonly<Record<string, readonly string[]>>;
    readonly direct?: boolean;
    readonly downloadable?: boolean;
  } = {},
): ResourceAccessDescriptor {
  const archive = kind === "archive" || format === "zip";
  const direct = options.direct ?? supportsDirectDataOperations(format);
  const operations: ResourceAccessOperation[] = ["inspect"];
  if (direct) operations.push("preview", "schema", "validate", "query", "convert");
  if (options.downloadable ?? kind === "file") operations.push("download");
  const selections = options.selections ?? {};
  const nextActions =
    selections.entries?.map((entry) =>
      action(
        "resource.preview",
        ["resource", "preview", input, "--entry", entry, "--json"],
        "Select one ZIP data entry",
      ),
    ) ??
    (direct
      ? [action("resource.preview", ["resource", "preview", input, "--limit", "20", "--json"])]
      : []);
  return {
    input,
    kind,
    detectedFormat: format,
    operations,
    ...(Object.keys(selections).length === 0 ? {} : { selections }),
    limitations: archive
      ? ["Only one non-nested supported ZIP entry is extracted per operation."]
      : [],
    nextActions,
  };
}

function archiveFailureDescriptor(
  input: string,
  failure: ArchiveFailure,
  downloadable: boolean,
): ResourceAccessDescriptor {
  const descriptor = dataDescriptor(input, "archive", "zip", {
    ...(failure.kind === "selection" ? { selections: { entries: failure.entries } } : {}),
    direct: false,
    downloadable,
  });
  if (failure.kind === "selection") return descriptor;
  return {
    ...descriptor,
    limitations: [
      ...descriptor.limitations,
      failure.kind === "archive-content"
        ? "The ZIP archive is malformed or contains no supported data entry."
        : "The selected entry must still pass format parsing or validation.",
    ],
  };
}

export class ResourceAccessService {
  private readonly local: LocalProvider;
  constructor(
    private readonly client: KlopsiClient,
    private readonly registry: ProviderRegistry,
    private readonly providerId: string,
    cwd = process.cwd(),
  ) {
    this.local = new LocalProvider({ cwd });
  }

  async inspect(
    input: string,
    options: DataResolutionOptions = {},
  ): Promise<ResourceAccessDescriptor> {
    if (input.startsWith("local:file:") || !/^[^:]+:(?:dataset|resource):/u.test(input)) {
      try {
        const source = await this.local.resolve(input);
        const detection = await detectFormat(source);
        if (detection.format === "zip") {
          try {
            const archive = await inspectArchive(detection.path);
            return dataDescriptor(input, "archive", "zip", {
              selections: { entries: archive.candidates },
              direct: true,
            });
          } catch (error) {
            const failure = classifyArchiveFailure(error);
            if (failure !== undefined) return archiveFailureDescriptor(input, failure, false);
            throw error;
          }
        }
        if (detection.format === "xml") {
          try {
            const preview = await this.client.data.preview(input, { ...options, limit: 1 });
            return dataDescriptor(input, "local", preview.format);
          } catch (error) {
            if (error instanceof KlopsiError && error.code === "XML_RECORD_PATH_REQUIRED")
              return {
                ...dataDescriptor(input, "local", "xml", {
                  selections: {
                    recordPaths: (error.context?.choices as readonly string[]) ?? [],
                  },
                }),
                nextActions: ((error.context?.choices as readonly string[]) ?? []).map((path) =>
                  action("resource.preview", [
                    "resource",
                    "preview",
                    input,
                    "--record-path",
                    path,
                    "--json",
                  ]),
                ),
              };
            throw error;
          }
        }
        return dataDescriptor(input, "local", detection.format);
      } catch (error) {
        if (!(error instanceof KlopsiError) || error.code !== "LOCAL_FILE_NOT_FOUND") throw error;
      }
    }
    let id: ResourceId;
    let providerId = this.providerId;
    if (input.includes(":")) {
      const reference = parseCanonicalReference(input);
      if (reference.kind !== "resource")
        throw new KlopsiError({
          code: "RESOURCE_REFERENCE_REQUIRED",
          message: "Resource inspection requires a resource or local file.",
          exitCode: EXIT_CODES.INVALID_INPUT,
        });
      id = reference.id;
      providerId = reference.providerId;
    } else id = resourceId(input);
    const provider = this.registry.get(providerId);
    const resource = await provider.getResource(id);
    const resolved = await provider.resolveResource(resource);
    const canonical = resource.reference ?? `${resource.providerId}:resource:${resource.id}`;
    if (resolved.kind === "service") {
      const protocol =
        resource.format?.trim().toLowerCase() === "wfs"
          ? "wfs"
          : resource.format?.trim().toLowerCase() === "wms"
            ? "wms"
            : "unknown";
      if (protocol === "wfs") {
        const inspected = await this.client.services.wfs.inspect(canonical, options);
        return {
          input: canonical,
          kind: "service",
          ...(resource.format === undefined ? {} : { declaredFormat: resource.format }),
          protocol,
          version: inspected.capabilities.version,
          operations: ["inspect", "layers", "schema", "preview", "count", "export"],
          selections: { layers: inspected.capabilities.layers.map((layer) => layer.name) },
          limitations: ["Read-only WFS requests; transactions and raw filters are not supported."],
          nextActions: [action("service.layers", ["service", "layers", canonical, "--json"])],
        };
      }
      return {
        input: canonical,
        kind: "service",
        ...(resource.format === undefined ? {} : { declaredFormat: resource.format }),
        protocol,
        operations: ["inspect"],
        limitations: [
          protocol === "wms"
            ? "WMS rendering is not supported; metadata inspection only."
            : "This service protocol is not supported for data access.",
        ],
        nextActions: [action("resource.show", ["resource", "show", canonical, "--json"])],
      };
    }
    if (resolved.kind === "archive") {
      try {
        await this.client.data.preview(canonical, { ...options, limit: 1 });
        return dataDescriptor(canonical, "archive", "zip", {
          direct: true,
          downloadable: true,
        });
      } catch (error) {
        const failure = classifyArchiveFailure(error);
        if (failure !== undefined) return archiveFailureDescriptor(canonical, failure, true);
        throw error;
      }
    }
    if (resolved.kind === "file") {
      const inspected = await this.client.data.inspect(canonical, options);
      return dataDescriptor(canonical, "file", inspected.format);
    }
    return {
      input: canonical,
      kind: resolved.kind,
      ...(resource.format === undefined ? {} : { declaredFormat: resource.format }),
      operations: resolved.kind === "page" ? ["inspect", "open"] : ["inspect"],
      limitations: [`${resolved.kind.toUpperCase()} resources are not tabular data inputs.`],
      nextActions:
        resolved.kind === "page"
          ? [action("dataset.open", ["dataset", "open", `${resource.datasetId}`])]
          : [action("resource.show", ["resource", "show", canonical, "--json"])],
    };
  }
}

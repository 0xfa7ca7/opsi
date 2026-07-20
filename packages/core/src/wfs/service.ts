import { copyFile, lstat, mkdtemp, open, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DataEngine, type DataRow } from "@opsi/data-engine";
import { EXIT_CODES, OpsiError, parseCanonicalReference, resourceId, type ResourceId } from "@opsi/domain";
import { Downloader, type DownloadLimits } from "@opsi/storage";
import type { ProviderRegistry } from "../registry.js";
import { buildWfsUrl } from "./url.js";
import { parseWfsCapabilities, parseWfsCount, parseWfsException, parseWfsSchema } from "./parser.js";
import type { WfsCapabilities, WfsField, WfsLayer, WfsQuery, WfsVersion } from "./types.js";

export interface WfsNetworkOptions {
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
  readonly signal?: AbortSignal;
}

export interface WfsSelectionOptions extends WfsNetworkOptions {
  readonly layer: string;
  readonly properties?: readonly string[];
  readonly filters?: Readonly<Record<string, string | number | boolean>>;
  readonly bbox?: readonly [number, number, number, number];
  readonly crs?: string;
  readonly limit?: number;
  readonly startIndex?: number;
}

export interface WfsPreviewResult {
  readonly version: WfsVersion;
  readonly layer: string;
  readonly columns: readonly string[];
  readonly rows: readonly DataRow[];
  readonly returnedCount: number;
  readonly truncated: boolean;
}

interface ResolvedWfs {
  readonly canonical: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

function serviceException(bytes: Buffer): OpsiError | undefined {
  return bytes.toString("utf8", 0, Math.min(bytes.length, 256)).trimStart().startsWith("<")
    ? parseWfsException(bytes)
    : undefined;
}

export interface WfsServiceOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
  readonly downloader?: Downloader;
  readonly limits: DownloadLimits;
  readonly offline?: boolean;
}

export class WfsService {
  private readonly downloader: Downloader;
  private readonly capabilitiesCache = new Map<string, WfsCapabilities>();
  private readonly schemaCache = new Map<string, readonly WfsField[]>();
  private readonly engine = new DataEngine();

  constructor(private readonly options: WfsServiceOptions) {
    this.downloader = options.downloader ?? new Downloader();
  }

  private async resolve(input: string): Promise<ResolvedWfs> {
    let id: ResourceId;
    let providerId = this.options.providerId;
    if (input.includes(":")) {
      const reference = parseCanonicalReference(input);
      if (reference.kind !== "resource") throw new OpsiError({ code: "RESOURCE_REFERENCE_REQUIRED", message: "WFS operations require a resource reference.", exitCode: EXIT_CODES.INVALID_INPUT });
      id = reference.id; providerId = reference.providerId;
    } else id = resourceId(input);
    const provider = this.options.registry.get(providerId);
    const resource = await provider.getResource(id);
    const resolved = await provider.resolveResource(resource);
    if (resolved.kind !== "service" || resource.format?.trim().toLowerCase() === "wms")
      throw new OpsiError({ code: "WFS_RESOURCE_REQUIRED", message: "The selected resource is not a WFS service.", exitCode: EXIT_CODES.UNSUPPORTED, context: { kind: resolved.kind, format: resource.format } });
    return { canonical: resource.reference ?? `${resource.providerId}:resource:${resource.id}`, url: resolved.url, ...(resolved.headers === undefined ? {} : { headers: resolved.headers }) };
  }

  private async fetch(resolved: ResolvedWfs, query: WfsQuery, network: WfsNetworkOptions): Promise<Buffer> {
    if (this.options.offline) throw new OpsiError({ code: "OFFLINE_CACHE_MISS", message: "Offline mode has no cached WFS response for this request.", exitCode: EXIT_CODES.NOT_FOUND });
    const directory = await mkdtemp(join(tmpdir(), "opsi-wfs-"));
    const destination = join(directory, "response");
    try {
      const url = buildWfsUrl(resolved.url, query);
      const result = await this.downloader.download({
        url: url.href,
        destination,
        force: false,
        limits: { ...this.options.limits, maxBytes: Math.min(this.options.limits.maxBytes, 64 * 1024 * 1024) },
        allowedOrigins: [new URL(resolved.url).origin],
        allowInsecureHttp: network.allowInsecureHttp ?? false,
        allowPrivateNetwork: network.allowPrivateNetwork ?? false,
        ...(network.signal === undefined ? {} : { signal: network.signal }),
        ...(resolved.headers === undefined ? {} : { headers: resolved.headers }),
      });
      return await import("node:fs/promises").then(({ readFile }) => readFile(result.path));
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async inspect(input: string, network: WfsNetworkOptions = {}): Promise<{ readonly resource: string; readonly capabilities: WfsCapabilities }> {
    const resolved = await this.resolve(input);
    let capabilities = this.capabilitiesCache.get(resolved.canonical);
    if (capabilities === undefined) {
      const bytes = await this.fetch(resolved, { version: "2.0.0", request: "GetCapabilities" }, network);
      const exception = serviceException(bytes); if (exception !== undefined) throw exception;
      capabilities = parseWfsCapabilities(bytes);
      this.capabilitiesCache.set(resolved.canonical, capabilities);
    }
    return { resource: resolved.canonical, capabilities };
  }

  async layers(input: string, network: WfsNetworkOptions = {}): Promise<readonly WfsLayer[]> {
    return (await this.inspect(input, network)).capabilities.layers;
  }

  async schema(input: string, options: WfsNetworkOptions & { readonly layer: string }): Promise<readonly WfsField[]> {
    const resolved = await this.resolve(input);
    const inspected = await this.inspect(input, options);
    if (!inspected.capabilities.layers.some((layer) => layer.name === options.layer))
      throw new OpsiError({ code: "WFS_LAYER_NOT_FOUND", message: "The WFS layer is not advertised by the service.", exitCode: EXIT_CODES.INVALID_INPUT, context: { layer: options.layer, choices: inspected.capabilities.layers.map((layer) => layer.name) } });
    const key = `${resolved.canonical}:${inspected.capabilities.version}:${options.layer}`;
    let fields = this.schemaCache.get(key);
    if (fields === undefined) {
      const bytes = await this.fetch(resolved, { version: inspected.capabilities.version, request: "DescribeFeatureType", layer: options.layer }, options);
      const exception = serviceException(bytes); if (exception !== undefined) throw exception;
      fields = parseWfsSchema(bytes, options.layer);
      this.schemaCache.set(key, fields);
    }
    return fields;
  }

  private async checked(input: string, options: WfsSelectionOptions): Promise<{ resolved: ResolvedWfs; version: WfsVersion }> {
    const resolved = await this.resolve(input);
    const inspected = await this.inspect(input, options);
    const fields = await this.schema(input, options);
    const names = new Set(fields.map((field) => field.name));
    for (const property of [...(options.properties ?? []), ...Object.keys(options.filters ?? {})])
      if (!names.has(property)) throw new OpsiError({ code: "WFS_FIELD_NOT_FOUND", message: "A selected WFS field is not present in the schema.", exitCode: EXIT_CODES.INVALID_INPUT, context: { property, choices: [...names] } });
    return { resolved, version: inspected.capabilities.version };
  }

  async preview(input: string, options: WfsSelectionOptions): Promise<WfsPreviewResult> {
    const checked = await this.checked(input, options);
    const limit = options.limit ?? 20;
    const bytes = await this.fetch(checked.resolved, { version: checked.version, request: "GetFeature", layer: options.layer, limit: limit + 1, startIndex: options.startIndex ?? 0, outputFormat: "text/csv", ...(options.properties === undefined ? {} : { properties: options.properties }), ...(options.filters === undefined ? {} : { filters: options.filters }), ...(options.bbox === undefined ? {} : { bbox: options.bbox }), ...(options.crs === undefined ? {} : { crs: options.crs }) }, options);
    const exception = serviceException(bytes); if (exception !== undefined) throw exception;
    const directory = await mkdtemp(join(tmpdir(), "opsi-wfs-preview-"));
    const path = join(directory, "features.csv");
    try {
      const handle = await open(path, "wx", 0o600); try { await handle.writeFile(bytes); } finally { await handle.close(); }
      const preview = await this.engine.preview(path, { limit });
      return { version: checked.version, layer: options.layer, columns: preview.columns, rows: preview.rows, returnedCount: preview.returnedCount, truncated: preview.truncated };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async count(input: string, options: Omit<WfsSelectionOptions, "limit" | "startIndex" | "properties">): Promise<{ readonly version: WfsVersion; readonly layer: string; readonly count: number }> {
    const checked = await this.checked(input, options);
    const bytes = await this.fetch(checked.resolved, { version: checked.version, request: "GetFeature", layer: options.layer, resultType: "hits", ...(options.filters === undefined ? {} : { filters: options.filters }), ...(options.bbox === undefined ? {} : { bbox: options.bbox }), ...(options.crs === undefined ? {} : { crs: options.crs }) }, options);
    const exception = serviceException(bytes); if (exception !== undefined) throw exception;
    return { version: checked.version, layer: options.layer, count: parseWfsCount(bytes) };
  }

  async export(input: string, options: WfsSelectionOptions & { readonly output: string; readonly force?: boolean; readonly format?: "csv" }): Promise<{ readonly output: string; readonly rows: number }> {
    const result = await this.preview(input, options);
    const output = resolve(options.output);
    try {
      const details = await lstat(output);
      if (!details.isFile() || details.isSymbolicLink()) throw new OpsiError({ code: "UNSAFE_SERVICE_DESTINATION", message: "The WFS export destination is not a regular file.", exitCode: EXIT_CODES.INVALID_INPUT });
      if (options.force !== true) throw new OpsiError({ code: "SERVICE_DESTINATION_EXISTS", message: "The WFS export destination already exists.", exitCode: EXIT_CODES.INVALID_INPUT });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = `${output}.part-${process.pid}`;
    const columns = result.columns;
    const cell = (value: unknown) => { const text = value == null ? "" : String(value); return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${columns.join(",")}\n${result.rows.map((row) => columns.map((column) => cell(row[column])).join(",")).join("\n")}\n`); await handle.sync(); } finally { await handle.close(); }
    try { await copyFile(temporary, output, options.force === true ? 0 : constants.COPYFILE_EXCL); } finally { await rm(temporary, { force: true }); }
    return { output, rows: result.returnedCount };
  }
}

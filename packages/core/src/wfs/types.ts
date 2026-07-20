export type WfsVersion = "2.0.0" | "1.1.0" | "1.0.0";
export type WfsRequest = "GetCapabilities" | "DescribeFeatureType" | "GetFeature";

export interface WfsLayer {
  readonly name: string;
  readonly title?: string;
  readonly defaultCrs?: string;
  readonly otherCrs: readonly string[];
}

export interface WfsCapabilities {
  readonly version: WfsVersion;
  readonly operations: readonly string[];
  readonly layers: readonly WfsLayer[];
  readonly outputFormats: readonly string[];
}

export interface WfsField {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
}

export interface WfsQuery {
  readonly version: WfsVersion;
  readonly request: WfsRequest;
  readonly layer?: string;
  readonly limit?: number;
  readonly startIndex?: number;
  readonly properties?: readonly string[];
  readonly outputFormat?: string;
  readonly resultType?: "hits" | "results";
  readonly bbox?: readonly [number, number, number, number];
  readonly crs?: string;
  readonly filters?: Readonly<Record<string, string | number | boolean>>;
}

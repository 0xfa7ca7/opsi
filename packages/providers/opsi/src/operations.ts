import { z } from "zod";
import {
  opsiDatasetSchema,
  opsiLicenseSchema,
  opsiOrganizationSchema,
  opsiResourceSchema,
  opsiTagSchema,
  packageSearchResultSchema,
  resourceSearchResultSchema,
  type OpsiDatasetRecord,
  type OpsiLicenseRecord,
  type OpsiOrganizationRecord,
  type OpsiResourceRecord,
  type OpsiTagRecord,
  type PackageSearchResult,
  type ResourceSearchResult,
} from "./contracts.js";

const emptyInput = z.strictObject({});
const paginationInput = z.strictObject({
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export interface PackageSearchInput {
  readonly q: string;
  readonly fq: string;
  readonly rows: number;
  readonly start: number;
  readonly facet: string;
  readonly "facet.field": readonly string[];
  readonly "facet.mincount": number;
  readonly "facet.limit": number;
  readonly sort: string;
}

export interface OpsiOperationInputs {
  readonly package_search: PackageSearchInput;
  readonly package_show: { readonly id: string; readonly use_default_schema: false };
  readonly package_list: { readonly limit?: number; readonly offset?: number };
  readonly current_package_list_with_resources: {
    readonly limit?: number;
    readonly offset?: number;
  };
  readonly package_autocomplete: { readonly q: string; readonly limit?: number };
  readonly resource_search: {
    readonly query: string;
    readonly order_by: string;
    readonly offset?: number;
    readonly limit?: number;
  };
  readonly resource_show: { readonly id: string };
  readonly organization_list: {
    readonly sort?: string;
    readonly organizations?: readonly string[];
    readonly all_fields?: boolean;
  };
  readonly tag_search: {
    readonly query: string;
    readonly offset?: number;
    readonly limit?: number;
    readonly vocabulary_id?: string;
  };
  readonly tag_autocomplete: {
    readonly query: string;
    readonly offset?: number;
    readonly limit?: number;
    readonly vocabulary_id?: string;
  };
  readonly tag_list: {
    readonly query?: string;
    readonly vocabulary_id?: string;
    readonly all_fields?: boolean;
  };
  readonly license_list: Record<string, never>;
  readonly status_show: Record<string, never>;
  readonly site_read: Record<string, never>;
}

export interface OpsiOperationResults {
  readonly package_search: PackageSearchResult;
  readonly package_show: OpsiDatasetRecord;
  readonly package_list: readonly string[];
  readonly current_package_list_with_resources: readonly OpsiDatasetRecord[];
  readonly package_autocomplete: readonly Readonly<Record<string, unknown>>[];
  readonly resource_search: ResourceSearchResult;
  readonly resource_show: OpsiResourceRecord;
  readonly organization_list: readonly (string | OpsiOrganizationRecord)[];
  readonly tag_search: readonly OpsiTagRecord[];
  readonly tag_autocomplete: readonly string[];
  readonly tag_list: readonly (string | OpsiTagRecord)[];
  readonly license_list: readonly OpsiLicenseRecord[];
  readonly status_show: Readonly<Record<string, unknown>>;
  readonly site_read: boolean;
}

export type OpsiOperationName = keyof OpsiOperationInputs;
export type ParameterLocation = "json" | "query" | "none";

interface OperationDefinition {
  readonly method: "GET" | "POST";
  readonly path: `/${string}`;
  readonly parameters: ParameterLocation;
  readonly retryable: boolean;
  readonly inputSchema: z.ZodType;
  readonly resultSchema: z.ZodType;
}

const tagSearchInput = z.strictObject({
  query: z.string(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().nonnegative().optional(),
  vocabulary_id: z.string().optional(),
});

export const OPSI_OPERATIONS = {
  package_search: {
    method: "POST",
    path: "/package_search",
    parameters: "json",
    retryable: true,
    inputSchema: z.strictObject({
      q: z.string(),
      fq: z.string(),
      rows: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
      facet: z.string(),
      "facet.field": z.array(z.string()),
      "facet.mincount": z.number().int(),
      "facet.limit": z.number().int(),
      sort: z.string(),
    }),
    resultSchema: packageSearchResultSchema,
  },
  package_show: {
    method: "GET",
    path: "/package_show",
    parameters: "query",
    retryable: true,
    inputSchema: z.strictObject({ id: z.string().min(1), use_default_schema: z.literal(false) }),
    resultSchema: opsiDatasetSchema,
  },
  package_list: {
    method: "GET",
    path: "/package_list",
    parameters: "query",
    retryable: true,
    inputSchema: paginationInput,
    resultSchema: z.array(z.string()),
  },
  current_package_list_with_resources: {
    method: "GET",
    path: "/current_package_list_with_resources",
    parameters: "query",
    retryable: true,
    inputSchema: paginationInput,
    resultSchema: z.array(opsiDatasetSchema),
  },
  package_autocomplete: {
    method: "GET",
    path: "/package_autocomplete",
    parameters: "query",
    retryable: true,
    inputSchema: z.strictObject({
      q: z.string(),
      limit: z.number().int().nonnegative().optional(),
    }),
    resultSchema: z.array(z.looseObject({})),
  },
  resource_search: {
    method: "GET",
    path: "/resource_search",
    parameters: "query",
    retryable: true,
    inputSchema: z.strictObject({
      query: z.string(),
      order_by: z.string(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().nonnegative().optional(),
    }),
    resultSchema: resourceSearchResultSchema,
  },
  resource_show: {
    method: "GET",
    path: "/resource_show",
    parameters: "query",
    retryable: true,
    inputSchema: z.strictObject({ id: z.string().min(1) }),
    resultSchema: opsiResourceSchema,
  },
  organization_list: {
    method: "POST",
    path: "/organization_list",
    parameters: "json",
    retryable: true,
    inputSchema: z.strictObject({
      sort: z.string().optional(),
      organizations: z.array(z.string()).optional(),
      all_fields: z.boolean().optional(),
    }),
    resultSchema: z.array(z.union([z.string(), opsiOrganizationSchema])),
  },
  tag_search: {
    method: "POST",
    path: "/tag_search",
    parameters: "json",
    retryable: true,
    inputSchema: tagSearchInput,
    resultSchema: z.array(opsiTagSchema),
  },
  tag_autocomplete: {
    method: "POST",
    path: "/tag_autocomplete",
    parameters: "json",
    retryable: true,
    inputSchema: tagSearchInput,
    resultSchema: z.array(z.string()),
  },
  tag_list: {
    method: "GET",
    path: "/tag_list",
    parameters: "query",
    retryable: true,
    inputSchema: z.strictObject({
      query: z.string().optional(),
      vocabulary_id: z.string().optional(),
      all_fields: z.boolean().optional(),
    }),
    resultSchema: z.array(z.union([z.string(), opsiTagSchema])),
  },
  license_list: {
    method: "GET",
    path: "/license_list",
    parameters: "none",
    retryable: true,
    inputSchema: emptyInput,
    resultSchema: z.array(opsiLicenseSchema),
  },
  status_show: {
    method: "GET",
    path: "/status_show",
    parameters: "none",
    retryable: true,
    inputSchema: emptyInput,
    resultSchema: z.looseObject({}),
  },
  site_read: {
    method: "GET",
    path: "/site_read",
    parameters: "none",
    retryable: true,
    inputSchema: emptyInput,
    resultSchema: z.boolean(),
  },
} as const satisfies Record<OpsiOperationName, OperationDefinition>;

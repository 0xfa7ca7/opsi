import { z } from "zod";

export const klopsiResourceSchema = z.looseObject({
  id: z.string().min(1),
  package_id: z.string().min(1).optional(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  url: z.string().min(1),
  format: z.string().nullish(),
  mimetype: z.string().nullish(),
  size: z.union([z.number(), z.string()]).nullish(),
  last_modified: z.string().nullish(),
});

export const klopsiDatasetSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  title: z.string().min(1),
  notes: z.string().nullish(),
  metadata_modified: z.string().nullish(),
  license_id: z.string().nullish(),
  license_title: z.string().nullish(),
  organization: z
    .looseObject({
      id: z.string().min(1),
      name: z.string().min(1),
      title: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  tags: z.array(z.looseObject({ name: z.string().min(1) })).optional(),
  resources: z.array(klopsiResourceSchema).optional(),
  num_resources: z.number().int().nonnegative().optional(),
});

export const klopsiTagSchema = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  display_name: z.string().optional(),
});

export const klopsiOrganizationSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
});

export const klopsiLicenseSchema = z.looseObject({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  url: z.string().optional(),
});

export const packageSearchResultSchema = z.looseObject({
  count: z.number().int().nonnegative(),
  sort: z.string().optional(),
  facets: z.record(z.string(), z.unknown()).optional(),
  search_facets: z.record(z.string(), z.unknown()).optional(),
  results: z.array(klopsiDatasetSchema),
});

export const resourceSearchResultSchema = z.looseObject({
  count: z.number().int().nonnegative(),
  results: z.array(klopsiResourceSchema),
});

export const failureEnvelopeSchema = z.looseObject({
  help: z.string().optional(),
  success: z.literal(false),
  error: z.looseObject({
    __type: z.string().optional(),
    message: z.string().optional(),
  }),
});

export function envelopeSchema<Result extends z.ZodType>(result: Result) {
  return z.discriminatedUnion("success", [
    z.looseObject({ help: z.string().optional(), success: z.literal(true), result }),
    failureEnvelopeSchema,
  ]);
}

export type KlopsiDatasetRecord = z.infer<typeof klopsiDatasetSchema>;
export type KlopsiResourceRecord = z.infer<typeof klopsiResourceSchema>;
export type KlopsiTagRecord = z.infer<typeof klopsiTagSchema>;
export type KlopsiOrganizationRecord = z.infer<typeof klopsiOrganizationSchema>;
export type KlopsiLicenseRecord = z.infer<typeof klopsiLicenseSchema>;
export type PackageSearchResult = z.infer<typeof packageSearchResultSchema>;
export type ResourceSearchResult = z.infer<typeof resourceSearchResultSchema>;

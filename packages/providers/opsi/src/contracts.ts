import { z } from "zod";

export const opsiResourceSchema = z.looseObject({
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

export const opsiDatasetSchema = z.looseObject({
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
  resources: z.array(opsiResourceSchema).optional(),
  num_resources: z.number().int().nonnegative().optional(),
});

export const opsiTagSchema = z.looseObject({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  display_name: z.string().optional(),
});

export const opsiOrganizationSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
});

export const opsiLicenseSchema = z.looseObject({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  url: z.string().optional(),
});

export const packageSearchResultSchema = z.looseObject({
  count: z.number().int().nonnegative(),
  sort: z.string().optional(),
  facets: z.record(z.string(), z.unknown()).optional(),
  search_facets: z.record(z.string(), z.unknown()).optional(),
  results: z.array(opsiDatasetSchema),
});

export const resourceSearchResultSchema = z.looseObject({
  count: z.number().int().nonnegative(),
  results: z.array(opsiResourceSchema),
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

export type OpsiDatasetRecord = z.infer<typeof opsiDatasetSchema>;
export type OpsiResourceRecord = z.infer<typeof opsiResourceSchema>;
export type OpsiTagRecord = z.infer<typeof opsiTagSchema>;
export type OpsiOrganizationRecord = z.infer<typeof opsiOrganizationSchema>;
export type OpsiLicenseRecord = z.infer<typeof opsiLicenseSchema>;
export type PackageSearchResult = z.infer<typeof packageSearchResultSchema>;
export type ResourceSearchResult = z.infer<typeof resourceSearchResultSchema>;

import type {
  DataValidationResult,
  SupportedDataFormat,
  ValidationIssue,
} from "@klopsi/data-engine";
import type { Dataset, Resource } from "@klopsi/domain";

function issue(
  code: string,
  severity: "error" | "warning" | "recommendation",
  message: string,
  recommendation: string,
  field?: string,
): ValidationIssue {
  return { code, severity, message, recommendation, ...(field === undefined ? {} : { field }) };
}

function result(issues: readonly ValidationIssue[]): DataValidationResult {
  const errors = issues.filter((candidate) => candidate.severity === "error");
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings: issues.filter((candidate) => candidate.severity === "warning"),
    recommendations: issues.filter((candidate) => candidate.severity === "recommendation"),
  };
}

export function validateDatasetMetadata(dataset: Dataset): DataValidationResult {
  const issues: ValidationIssue[] = [];
  if (dataset.title.trim().length === 0)
    issues.push(
      issue(
        "MISSING_TITLE",
        "error",
        "Dataset title is missing.",
        "Add a concise, descriptive dataset title.",
        "title",
      ),
    );
  if (dataset.description?.trim()) {
    // Present and non-empty.
  } else
    issues.push(
      issue(
        "MISSING_DESCRIPTION",
        "warning",
        "Dataset description is missing.",
        "Explain the dataset's purpose, coverage, and limitations.",
        "description",
      ),
    );
  if (dataset.license === undefined)
    issues.push(
      issue(
        "MISSING_LICENSE",
        "warning",
        "Dataset license is missing.",
        "Declare a machine-readable reuse license.",
        "license",
      ),
    );
  if (dataset.organization === undefined)
    issues.push(
      issue(
        "MISSING_ORGANIZATION",
        "warning",
        "Dataset organization is missing.",
        "Identify the organization responsible for the dataset.",
        "organization",
      ),
    );
  if (dataset.modifiedAt === undefined || Number.isNaN(Date.parse(dataset.modifiedAt)))
    issues.push(
      issue(
        "MISSING_MODIFICATION_TIMESTAMP",
        "warning",
        "Dataset modification timestamp is missing or invalid.",
        "Publish a valid ISO 8601 modification timestamp.",
        "modifiedAt",
      ),
    );
  return result(issues);
}

function normalizedFormat(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase().replace(/^\./u, "");
  return normalized === "jsonl" ? "ndjson" : normalized;
}

export function validateResourceMetadata(
  resource: Resource,
  options: { readonly detectedFormat?: SupportedDataFormat } = {},
): DataValidationResult {
  const issues: ValidationIssue[] = [];
  try {
    const url = new URL(resource.url);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("unsupported scheme");
  } catch {
    issues.push(
      issue(
        "INVALID_RESOURCE_URL",
        "error",
        "Resource URL is not a valid HTTP(S) URL.",
        "Publish an absolute HTTPS URL for the resource.",
        "url",
      ),
    );
  }
  if (resource.title.trim().length === 0)
    issues.push(
      issue(
        "MISSING_TITLE",
        "error",
        "Resource title is missing.",
        "Add a concise resource title.",
        "title",
      ),
    );
  if (resource.description?.trim()) {
    // Present and non-empty.
  } else
    issues.push(
      issue(
        "MISSING_DESCRIPTION",
        "warning",
        "Resource description is missing.",
        "Describe this resource's contents and structure.",
        "description",
      ),
    );
  const declared = normalizedFormat(resource.format);
  if (
    options.detectedFormat !== undefined &&
    declared !== undefined &&
    declared !== options.detectedFormat
  )
    issues.push(
      issue(
        "DECLARED_FORMAT_MISMATCH",
        "warning",
        `Declared format '${resource.format}' disagrees with detected format '${options.detectedFormat}'.`,
        "Correct the declared format or replace the resource with matching content.",
        "format",
      ),
    );
  return result(issues);
}

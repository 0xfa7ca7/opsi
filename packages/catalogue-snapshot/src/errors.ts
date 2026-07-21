import { EXIT_CODES, KlopsiError } from "@klopsi/domain";

const LIVE_REMEDIATION =
  "or use `klopsi dataset list --live` when direct OPSI access is acceptable.";

export function snapshotInvalid(field: string): KlopsiError {
  return new KlopsiError({
    code: "CATALOGUE_SNAPSHOT_INVALID",
    message: "Catalogue snapshot validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    suggestion: `Retry to fetch a new snapshot, check the catalogue service status if the problem persists, ${LIVE_REMEDIATION}`,
    context: { field },
  });
}

export function snapshotIntegrity(field: string): KlopsiError {
  return new KlopsiError({
    code: "CATALOGUE_SNAPSHOT_INTEGRITY",
    message: "Catalogue snapshot integrity validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    suggestion: `Retry to fetch a new snapshot, check the catalogue service status if the mismatch persists, ${LIVE_REMEDIATION}`,
    context: { field },
  });
}

export function snapshotStale(): KlopsiError {
  return new KlopsiError({
    code: "CATALOGUE_SNAPSHOT_STALE",
    message: "The catalogue snapshot is older than 24 hours.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    suggestion: `Retry after the catalogue service publishes a fresh snapshot, check the service status, ${LIVE_REMEDIATION}`,
    context: { field: "generatedAt" },
  });
}

export function snapshotUnavailable(): KlopsiError {
  return new KlopsiError({
    code: "CATALOGUE_SNAPSHOT_UNAVAILABLE",
    message: "The catalogue snapshot is unavailable.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    suggestion: `Retry shortly, check the catalogue service status, ${LIVE_REMEDIATION}`,
  });
}

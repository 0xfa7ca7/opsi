import { randomUUID } from "node:crypto";
import { link, lstat, open, rename, rm, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import { CacheLock } from "./cache-lock.js";

export type PairPublicationPoint =
  | "artifact-published"
  | "sidecar-published"
  | "artifact-backup-remove"
  | "sidecar-backup-remove"
  | "artifact-restore"
  | "sidecar-restore";
export interface PairPublicationOptions {
  readonly force?: boolean;
  readonly fault?: (point: PairPublicationPoint) => void;
  readonly existsCode?: string;
  readonly existsExitCode?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

async function existsRegular(path: string): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink())
      throw new KlopsiError({
        code: "UNSAFE_ARTIFACT_DESTINATION",
        message: "The publication destination is not a regular file.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory sync is unavailable on some platforms.
  }
}

function destinationExists(
  code = "ARTIFACT_DESTINATION_EXISTS",
  exitCode: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = EXIT_CODES.INVALID_INPUT,
): KlopsiError {
  return new KlopsiError({
    code,
    message: "The artifact or its provenance sidecar already exists.",
    exitCode,
    suggestion: "Use --force only after checking both files.",
  });
}

function recoveryError(
  code: "ARTIFACT_PUBLICATION_CLEANUP_FAILED" | "ARTIFACT_PUBLICATION_ROLLBACK_FAILED",
  message: string,
  failures: readonly unknown[],
  recoveryPaths: readonly string[],
  operationError?: unknown,
): KlopsiError {
  return new KlopsiError({
    code,
    message,
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    suggestion: "Inspect and retain the listed recovery paths before retrying.",
    context: {
      failureCount: failures.length,
      recoveryPaths,
      failures: failures.map((failure) =>
        failure instanceof Error ? failure.message : String(failure),
      ),
    },
    cause: new AggregateError(
      operationError === undefined ? failures : [operationError, ...failures],
      message,
    ),
  });
}

export async function publishArtifactPair(
  stagedArtifact: string,
  stagedSidecar: string,
  requestedDestination: string,
  options: PairPublicationOptions = {},
): Promise<{ readonly output: string; readonly provenancePath: string }> {
  const destination = resolve(requestedDestination);
  const provenancePath = `${destination}.provenance.json`;
  const directory = dirname(destination);
  const lock = await CacheLock.acquire(directory, `artifact-pair:${destination}`);
  const token = `${process.pid}-${randomUUID()}`;
  const artifactBackup = `${destination}.backup-${token}`;
  const sidecarBackup = `${provenancePath}.backup-${token}`;
  let artifactPublished = false;
  let sidecarPublished = false;
  let artifactBackedUp = false;
  let sidecarBackedUp = false;
  let committed = false;
  try {
    const [artifactExists, sidecarExists] = await Promise.all([
      existsRegular(destination),
      existsRegular(provenancePath),
    ]);
    if (!options.force && (artifactExists || sidecarExists))
      throw destinationExists(options.existsCode, options.existsExitCode);
    if (options.force) {
      if (artifactExists) {
        await rename(destination, artifactBackup);
        artifactBackedUp = true;
      }
      if (sidecarExists) {
        await rename(provenancePath, sidecarBackup);
        sidecarBackedUp = true;
      }
      await rename(stagedArtifact, destination);
      artifactPublished = true;
      options.fault?.("artifact-published");
      await rename(stagedSidecar, provenancePath);
      sidecarPublished = true;
    } else {
      await link(stagedArtifact, destination);
      artifactPublished = true;
      options.fault?.("artifact-published");
      await link(stagedSidecar, provenancePath);
      sidecarPublished = true;
      await Promise.all([unlink(stagedArtifact), unlink(stagedSidecar)]);
    }
    options.fault?.("sidecar-published");
    await syncDirectory(directory);
    committed = true;
    const cleanupFailures: unknown[] = [];
    const recoveryPaths: string[] = [];
    if (artifactBackedUp)
      try {
        options.fault?.("artifact-backup-remove");
        await rm(artifactBackup);
        artifactBackedUp = false;
      } catch (error) {
        cleanupFailures.push(error);
        recoveryPaths.push(artifactBackup);
      }
    if (sidecarBackedUp)
      try {
        options.fault?.("sidecar-backup-remove");
        await rm(sidecarBackup);
        sidecarBackedUp = false;
      } catch (error) {
        cleanupFailures.push(error);
        recoveryPaths.push(sidecarBackup);
      }
    if (cleanupFailures.length > 0)
      throw recoveryError(
        "ARTIFACT_PUBLICATION_CLEANUP_FAILED",
        "The new artifact pair is committed, but backup cleanup was incomplete.",
        cleanupFailures,
        recoveryPaths,
      );
    return { output: destination, provenancePath };
  } catch (error) {
    if (committed) throw error;
    const rollbackFailures: unknown[] = [];
    if (sidecarPublished)
      await rm(provenancePath, { force: true }).catch((failure) => rollbackFailures.push(failure));
    if (artifactPublished)
      await rm(destination, { force: true }).catch((failure) => rollbackFailures.push(failure));
    if (artifactBackedUp)
      try {
        options.fault?.("artifact-restore");
        await rename(artifactBackup, destination);
        artifactBackedUp = false;
      } catch (failure) {
        rollbackFailures.push(failure);
      }
    if (sidecarBackedUp)
      try {
        options.fault?.("sidecar-restore");
        await rename(sidecarBackup, provenancePath);
        sidecarBackedUp = false;
      } catch (failure) {
        rollbackFailures.push(failure);
      }
    await syncDirectory(directory);
    if (rollbackFailures.length > 0)
      throw recoveryError(
        "ARTIFACT_PUBLICATION_ROLLBACK_FAILED",
        "Artifact publication failed and the original pair could not be fully restored.",
        rollbackFailures,
        [
          ...(artifactBackedUp ? [artifactBackup] : []),
          ...(sidecarBackedUp ? [sidecarBackup] : []),
        ],
        error,
      );
    throw error;
  } finally {
    await lock.release();
  }
}

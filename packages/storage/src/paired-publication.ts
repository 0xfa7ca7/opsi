import { randomUUID } from "node:crypto";
import { link, lstat, open, rename, rm, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { CacheLock } from "./cache-lock.js";

export type PairPublicationPoint = "artifact-published" | "sidecar-published";
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
      throw new OpsiError({
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
): OpsiError {
  return new OpsiError({
    code,
    message: "The artifact or its provenance sidecar already exists.",
    exitCode,
    suggestion: "Use --force only after checking both files.",
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
    await Promise.all([rm(artifactBackup, { force: true }), rm(sidecarBackup, { force: true })]);
    return { output: destination, provenancePath };
  } catch (error) {
    if (sidecarPublished) await rm(provenancePath, { force: true });
    if (artifactPublished) await rm(destination, { force: true });
    if (artifactBackedUp) await rename(artifactBackup, destination).catch(() => undefined);
    if (sidecarBackedUp) await rename(sidecarBackup, provenancePath).catch(() => undefined);
    await syncDirectory(directory);
    throw error;
  } finally {
    await lock.release();
  }
}

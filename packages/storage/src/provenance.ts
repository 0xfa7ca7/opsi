import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { z } from "zod";

const SECRET_PARAMETERS =
  /^(?:access[_-]?token|api[_-]?key|authorization|credential|key|password|secret|sig|signature|token)$/iu;
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()])
      if (SECRET_PARAMETERS.test(key)) url.searchParams.set(key, "REDACTED");
    return url.toString();
  } catch {
    return "[REDACTED_INVALID_URL]";
  }
}
const provenanceSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  sourceUrl: z.string(),
  finalUrl: z.string(),
  redirectChain: z.array(z.string()),
  retrievedAt: z.iso.datetime(),
  sha256: z.string().regex(/^[a-f\d]{64}$/u),
  bytes: z.number().int().nonnegative(),
  mediaType: z.string().optional(),
  overrideFlags: z.strictObject({
    allowPrivateNetwork: z.boolean(),
    allowInsecureHttp: z.boolean(),
  }),
  providerId: z.string().optional(),
  datasetId: z.string().optional(),
  resourceId: z.string().optional(),
  localPath: z.string(),
});
export type StoredProvenance = z.infer<typeof provenanceSchema>;
export type ProvenanceInput = Omit<
  StoredProvenance,
  "schemaVersion" | "localPath" | "sourceUrl" | "finalUrl" | "redirectChain"
> & {
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
};
async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function integrity(message: string, cause?: unknown): OpsiError {
  return new OpsiError({
    code: "PROVENANCE_INTEGRITY_FAILURE",
    message,
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    ...(cause === undefined ? {} : { cause }),
  });
}
export class ProvenanceStore {
  pathFor(artifact: string): string {
    return `${artifact}.provenance.json`;
  }
  async write(artifact: string, input: ProvenanceInput): Promise<string> {
    const details = await lstat(artifact);
    if (!details.isFile() || details.isSymbolicLink())
      throw integrity("The artifact is not a durable regular file.");
    if (details.size !== input.bytes || (await digest(artifact)) !== input.sha256)
      throw integrity("The artifact does not match the proposed provenance.");
    const value: StoredProvenance = {
      schemaVersion: "1",
      ...input,
      sourceUrl: redactUrl(input.sourceUrl),
      finalUrl: redactUrl(input.finalUrl),
      redirectChain: input.redirectChain.map(redactUrl),
      localPath: artifact,
    };
    provenanceSchema.parse(value);
    const path = this.pathFor(artifact);
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, path);
      try {
        const directory = await open(dirname(path), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } catch {
        // Opening directories is not supported on every Node platform.
      }
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return path;
  }
  async read(artifact: string): Promise<StoredProvenance> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.pathFor(artifact), "utf8")) as unknown;
    } catch (error) {
      throw integrity("The provenance record cannot be read.", error);
    }
    const parsed = provenanceSchema.safeParse(value);
    if (!parsed.success || parsed.data.localPath !== artifact)
      throw integrity(
        "The provenance record is invalid.",
        parsed.success ? undefined : parsed.error,
      );
    return parsed.data;
  }
  async verify(
    artifact: string,
  ): Promise<{ readonly valid: true; readonly sha256: string; readonly bytes: number }> {
    const record = await this.read(artifact);
    const details = await lstat(artifact);
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      details.size !== record.bytes ||
      (await digest(artifact)) !== record.sha256
    )
      throw integrity("The artifact no longer matches its provenance.");
    return { valid: true, sha256: record.sha256, bytes: record.bytes };
  }
}

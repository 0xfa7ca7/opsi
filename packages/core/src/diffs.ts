import { resolve } from "node:path";
import type { DataDiffResult } from "@klopsi/domain";
import type { DataInput, DatasetDiffEngine, DatasetDiffEngineResult } from "@klopsi/data-engine";
import type { DataService } from "./data.js";

export interface DiffServiceOptions {
  readonly key: readonly string[];
  readonly sampleLimit?: number;
  readonly beforeSheet?: string;
  readonly afterSheet?: string;
  readonly beforeEntry?: string;
  readonly afterEntry?: string;
  readonly beforeRecordPath?: string;
  readonly afterRecordPath?: string;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
  readonly timeoutMs?: number;
  readonly memoryLimit?: string;
  readonly threads?: number;
  readonly signal?: AbortSignal;
}

type DiffEngine = Pick<DatasetDiffEngine, "compare">;

function sourcePath(input: DataInput): string {
  return resolve(typeof input === "string" ? input : input.path);
}

export class DiffService {
  constructor(
    private readonly data: Pick<DataService, "withResolvedInput">,
    private readonly engine: DiffEngine,
  ) {}

  compare(before: string, after: string, options: DiffServiceOptions): Promise<DataDiffResult> {
    const sharedResolution = {
      ...(options.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
      ...(options.allowPrivateNetwork === undefined
        ? {}
        : { allowPrivateNetwork: options.allowPrivateNetwork }),
    };
    return this.data.withResolvedInput(
      before,
      {
        ...sharedResolution,
        ...(options.beforeEntry === undefined ? {} : { entry: options.beforeEntry }),
        ...(options.beforeRecordPath === undefined ? {} : { recordPath: options.beforeRecordPath }),
      },
      (beforeSource) =>
        this.data.withResolvedInput(
          after,
          {
            ...sharedResolution,
            ...(options.afterEntry === undefined ? {} : { entry: options.afterEntry }),
            ...(options.afterRecordPath === undefined
              ? {}
              : { recordPath: options.afterRecordPath }),
          },
          async (afterSource) => {
            const started = performance.now();
            const compared: DatasetDiffEngineResult = await this.engine.compare({
              before: beforeSource,
              after: afterSource,
              key: options.key,
              ...(options.sampleLimit === undefined ? {} : { sampleLimit: options.sampleLimit }),
              ...(options.beforeSheet === undefined ? {} : { beforeSheet: options.beforeSheet }),
              ...(options.afterSheet === undefined ? {} : { afterSheet: options.afterSheet }),
              ...(options.beforeRecordPath === undefined
                ? {}
                : { beforeRecordPath: options.beforeRecordPath }),
              ...(options.afterRecordPath === undefined
                ? {}
                : { afterRecordPath: options.afterRecordPath }),
              ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
              ...(options.memoryLimit === undefined ? {} : { memoryLimit: options.memoryLimit }),
              ...(options.threads === undefined ? {} : { threads: options.threads }),
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
            return {
              ...compared,
              before: sourcePath(beforeSource),
              after: sourcePath(afterSource),
              durationMs: performance.now() - started,
            };
          },
        ),
    );
  }
}

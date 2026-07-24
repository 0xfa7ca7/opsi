import type { Command } from "commander";
import type { KlopsiClient } from "@klopsi/core";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";
import {
  CHART_RENDERER_VERSION,
  normalizeChartPoints,
  renderChartHtml,
  type ChartType,
} from "../chart/render.js";
import { publishChart } from "../chart/publish.js";

const MAX_POINTS = 500;
const X_ALIAS = "__klopsi_x";
const Y_ALIAS = "__klopsi_y";
const ORDER_ALIAS = "__klopsi_order";
const SOURCE_ALIAS = "__klopsi_chart_source";

function sqlIdentifier(value: string): string {
  if (value.includes("\0"))
    throw new KlopsiError({
      code: "CHART_COLUMN_INVALID",
      message: "Chart column names cannot contain a NUL byte.",
      exitCode: EXIT_CODES.INVALID_INPUT,
    });
  return `"${value.replaceAll('"', '""')}"`;
}

export function registerChartCommand(
  program: Command,
  context: CliContext,
  client: KlopsiClient,
): void {
  manifestCommand(program, "chart").action(
    async (
      input: string,
      options: {
        readonly x: string;
        readonly y: string;
        readonly type: ChartType;
        readonly output: string;
        readonly title?: string;
        readonly limit: number;
        readonly force?: boolean;
        readonly sheet?: string;
        readonly entry?: string;
        readonly recordPath?: string;
        readonly allowInsecureHttp?: boolean;
        readonly allowPrivateNetwork?: boolean;
      },
    ) => {
      if (options.limit > MAX_POINTS)
        throw new KlopsiError({
          code: "CHART_POINT_LIMIT",
          message: `Chart point limit cannot exceed ${MAX_POINTS}.`,
          exitCode: EXIT_CODES.INVALID_INPUT,
          suggestion: "Aggregate or filter the input first, then chart at most 500 points.",
          context: { requested: options.limit, maximum: MAX_POINTS },
        });
      const global = program.opts() as {
        readonly queryTimeoutMs?: number;
        readonly duckdbMemoryLimit?: string;
        readonly duckdbThreads?: number;
        readonly quiet?: boolean;
      };
      const timeoutMs = context.configuration?.query.timeoutMs ?? global.queryTimeoutMs;
      const memoryLimit = context.configuration?.duckdb.memoryLimit ?? global.duckdbMemoryLimit;
      const threads = context.configuration?.duckdb.threads ?? global.duckdbThreads;
      const sql =
        `WITH ${sqlIdentifier(SOURCE_ALIAS)} AS (` +
        `SELECT row_number() OVER () AS ${sqlIdentifier(ORDER_ALIAS)}, ` +
        `${sqlIdentifier(options.x)} AS ${sqlIdentifier(X_ALIAS)}, ` +
        `${sqlIdentifier(options.y)} AS ${sqlIdentifier(Y_ALIAS)} FROM data) ` +
        `SELECT ${sqlIdentifier(X_ALIAS)}, ${sqlIdentifier(Y_ALIAS)} ` +
        `FROM ${sqlIdentifier(SOURCE_ALIAS)} ORDER BY ${sqlIdentifier(ORDER_ALIAS)}`;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        const query = await client.query.execute(input, {
          sql,
          limit: options.limit,
          includeSourceDigest: true,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(memoryLimit === undefined ? {} : { memoryLimit }),
          ...(threads === undefined ? {} : { threads }),
          ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
          ...(options.entry === undefined ? {} : { entry: options.entry }),
          ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
          allowInsecureHttp: options.allowInsecureHttp ?? false,
          allowPrivateNetwork: options.allowPrivateNetwork ?? false,
          signal: controller.signal,
        });
        if (query.sourceSha256 === undefined)
          throw new KlopsiError({
            code: "CHART_SOURCE_DIGEST_UNAVAILABLE",
            message: "The resolved chart source digest is unavailable.",
            exitCode: EXIT_CODES.INTEGRITY_FAILURE,
          });
        const points = normalizeChartPoints(query.rows, X_ALIAS, Y_ALIAS);
        const title = options.title ?? `${options.y} by ${options.x}`;
        const html = renderChartHtml({
          type: options.type,
          title,
          x: options.x,
          y: options.y,
          points,
          limit: options.limit,
          truncated: query.truncated,
        });
        const published = await publishChart({
          sourceSha256: query.sourceSha256,
          output: options.output,
          html,
          force: options.force ?? false,
          transformation: {
            rendererVersion: CHART_RENDERER_VERSION,
            type: options.type,
            x: options.x,
            y: options.y,
            title,
            limit: options.limit,
            points: points.length,
            truncated: query.truncated,
            order: "source",
          },
        });
        if (global.quiet !== true)
          for (const warning of query.warnings)
            context.io.stderr.write(`warning [${warning.code}]: ${warning.message}\n`);
        context.renderer?.write(
          {
            output: published.output,
            provenancePath: published.provenancePath,
            type: options.type,
            x: options.x,
            y: options.y,
            points: points.length,
            limit: options.limit,
            truncated: query.truncated,
            order: "source",
          },
          { rendererVersion: CHART_RENDERER_VERSION },
        );
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    },
  );
}

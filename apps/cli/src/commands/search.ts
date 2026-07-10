import type { OpsiClient } from "@opsi/core";
import type { SearchQuery, SearchSort } from "@opsi/domain";
import { InvalidArgumentError, type Command } from "commander";
import type { CliContext } from "../context.js";

interface SearchOptions {
  readonly organization?: string;
  readonly tag?: readonly string[];
  readonly format?: readonly string[];
  readonly license?: string;
  readonly modifiedAfter?: string;
  readonly modifiedBefore?: string;
  readonly sort?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

function nonnegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return parsed;
}

function collect(value: string, previous: readonly string[]): readonly string[] {
  return [...previous, value];
}

function searchSort(values: readonly string[] | undefined): readonly SearchSort[] | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return values.map((value) => {
    const [field, direction, extra] = value.split(":");
    if (
      field === undefined ||
      field.length === 0 ||
      (direction !== "asc" && direction !== "desc") ||
      extra !== undefined
    ) {
      throw new InvalidArgumentError("sort must use <field>:<asc|desc>");
    }
    return { field, direction };
  });
}

export function registerSearchCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  program
    .command("search")
    .description("Search datasets")
    .argument("[text]", "full-text search query")
    .option("--organization <name>", "filter by organization")
    .option("--tag <name>", "filter by tag (repeatable)", collect, [])
    .option("--format <name>", "filter by resource format (repeatable)", collect, [])
    .option("--license <id>", "filter by license")
    .option("--modified-after <date>", "filter by earliest modification date")
    .option("--modified-before <date>", "filter by latest modification date")
    .option("--sort <field:direction>", "sort result (repeatable)", collect, [])
    .option("--limit <number>", "maximum results", positiveInteger)
    .option("--offset <number>", "result offset", nonnegativeInteger)
    .action(async (text: string | undefined, options: SearchOptions) => {
      const filters = {
        ...(options.organization === undefined ? {} : { organization: options.organization }),
        ...(options.tag === undefined ? {} : { tags: options.tag }),
        ...(options.format === undefined ? {} : { formats: options.format }),
        ...(options.license === undefined ? {} : { license: options.license }),
        ...(options.modifiedAfter === undefined ? {} : { modifiedAfter: options.modifiedAfter }),
        ...(options.modifiedBefore === undefined ? {} : { modifiedBefore: options.modifiedBefore }),
      };
      const sort = searchSort(options.sort);
      const query: SearchQuery = {
        ...(text === undefined ? {} : { text }),
        ...(Object.keys(filters).length === 0 ? {} : { filters }),
        ...(sort === undefined ? {} : { sort }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.offset === undefined ? {} : { offset: options.offset }),
      };
      const page = await client.search(query);
      context.renderer?.write(page.items, {
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
      });
    });
}

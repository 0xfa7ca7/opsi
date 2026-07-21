import type { KlopsiClient } from "@klopsi/core";
import { EXIT_CODES, KlopsiError, type SearchQuery, type SearchSort } from "@klopsi/domain";
import { InvalidArgumentError, type Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

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
  readonly all?: boolean;
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

function paginationError(message: string): KlopsiError {
  return new KlopsiError({
    code: "SEARCH_PAGINATION_INVALID",
    message,
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    suggestion: "Narrow the search or use --limit and --offset to retrieve a bounded page.",
  });
}

function resultLimitError(maximum: number): KlopsiError {
  return new KlopsiError({
    code: "SEARCH_RESULT_LIMIT_EXCEEDED",
    message: `Search --all is limited to ${maximum} results.`,
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Narrow the search or use --limit and --offset.",
    context: { maximum },
  });
}

export function registerSearchCommand(
  program: Command,
  context: CliContext,
  client: KlopsiClient,
): void {
  manifestCommand(program, "search").action(
    async (text: string | undefined, options: SearchOptions) => {
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
      if (options.all === true) {
        const items = [...page.items];
        let nextOffset = page.nextOffset;
        let pages = 1;
        const maximum = 10_000;
        if (page.total - page.offset > maximum) throw resultLimitError(maximum);
        while (nextOffset !== undefined) {
          if (items.length >= maximum) throw resultLimitError(maximum);
          if (nextOffset <= (query.offset ?? 0))
            throw paginationError("The provider returned a non-advancing search page.");
          const next = await client.search({ ...query, offset: nextOffset });
          items.push(...next.items);
          pages += 1;
          if (items.length > maximum) throw resultLimitError(maximum);
          if (next.nextOffset !== undefined && next.nextOffset <= nextOffset)
            throw paginationError("The provider returned a non-advancing search page.");
          nextOffset = next.nextOffset;
        }
        context.renderer?.write(items, {
          total: page.total,
          limit: items.length,
          offset: page.offset,
          all: true,
          pages,
        });
        return;
      }
      context.renderer?.write(page.items, {
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
      });
    },
  );
}

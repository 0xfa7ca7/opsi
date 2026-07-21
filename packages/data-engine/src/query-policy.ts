import type { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";

export const DEFAULT_MAX_SQL_BYTES = 64 * 1024;

function forbidden(code: string, message: string): KlopsiError {
  return new KlopsiError({ code, message, exitCode: EXIT_CODES.QUERY_FAILURE });
}

function diagnosticForbiddenToken(sql: string): boolean {
  const withoutLeadingComments = sql.replace(
    /^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/u,
    "",
  );
  return /^(?:PRAGMA|COPY|ATTACH|DETACH|INSTALL|FORCE\s+INSTALL|LOAD|SET|CALL|CREATE|DROP|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|EXPORT|EXPLAIN)\b/iu.test(
    withoutLeadingComments,
  );
}

export class QueryPolicy {
  static async validate(
    sql: string,
    options: { readonly connection?: DuckDBConnection; readonly maxSqlBytes?: number } = {},
  ): Promise<void> {
    const maxSqlBytes = options.maxSqlBytes ?? DEFAULT_MAX_SQL_BYTES;
    if (Buffer.byteLength(sql, "utf8") > maxSqlBytes)
      throw forbidden("QUERY_SQL_TOO_LARGE", `SQL exceeds the ${maxSqlBytes}-byte limit.`);
    if (sql.trim().length === 0) throw forbidden("QUERY_FORBIDDEN", "A SELECT query is required.");
    if (diagnosticForbiddenToken(sql))
      throw forbidden("QUERY_FORBIDDEN", "This statement is not allowed in a read-only query.");

    let ownedInstance: DuckDBInstance | undefined;
    let connection = options.connection;
    try {
      if (connection === undefined) {
        const { DuckDBInstance } = await import("@duckdb/node-api");
        ownedInstance = await DuckDBInstance.create(":memory:", {
          enable_external_access: "false",
          autoinstall_known_extensions: "false",
          autoload_known_extensions: "false",
          allow_community_extensions: "false",
        });
        connection = await ownedInstance.connect();
      }
      const extracted = await connection.extractStatements(sql);
      if (extracted.count !== 1)
        throw forbidden("QUERY_FORBIDDEN", "Exactly one SELECT statement is allowed.");
      let prepared;
      try {
        prepared = await extracted.prepare(0);
        if (prepared.statementType !== 1)
          throw forbidden("QUERY_FORBIDDEN", "Only SELECT, WITH ... SELECT, or VALUES is allowed.");
      } finally {
        prepared?.destroySync();
      }
    } catch (error) {
      if (error instanceof KlopsiError) throw error;
      throw forbidden("QUERY_FORBIDDEN", error instanceof Error ? error.message : "Invalid query.");
    } finally {
      if (ownedInstance !== undefined) {
        connection?.closeSync();
        ownedInstance.closeSync();
      }
    }
  }
}

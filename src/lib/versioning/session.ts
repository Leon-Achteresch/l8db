import type { SavedConnection } from "@/lib/connections";
import {
  beginTransaction,
  executeInTransaction,
  executeQuery,
  rollbackTransaction,
  versioningOracleTimeout,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { bindingForContext } from "./binding";
import { defaultSafety } from "./safety";
import type { DatabaseRelease, DatabaseTarget, VersioningProject } from "./types";

export const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

const contextSql = (kind: VersioningProject["kind"]) =>
  kind === "postgres"
    ? `SELECT current_database() AS "database", current_user AS "user", COALESCE(inet_server_addr()::text, 'local') AS "server", inet_server_port()::text AS "port", NULL::text AS "edition"`
    : `SELECT SYS_CONTEXT('USERENV', 'DB_UNIQUE_NAME') AS "database", SYS_CONTEXT('USERENV', 'SESSION_USER') AS "user", SYS_CONTEXT('USERENV', 'SERVER_HOST') AS "server", SYS_CONTEXT('USERENV', 'CON_NAME') AS "port", SYS_CONTEXT('USERENV', 'CURRENT_EDITION_NAME') AS "edition" FROM dual`;

export async function databaseBinding(
  connection: SavedConnection,
  target: DatabaseTarget,
  transaction?: string,
) {
  if (connection.kind !== "postgres" && connection.kind !== "oracle")
    throw new Error("Versionierungsanbieter fehlt.");
  const sql = contextSql(connection.kind);
  const result = transaction
    ? await executeInTransaction(transaction, sql, { confirmed: true })
    : await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        target.database ?? undefined,
      );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row?.database || !row.user)
    throw new Error("Datenbankidentität konnte nicht eindeutig ermittelt werden.");
  return bindingForContext(connection, target, row);
}

export function versioningSessionSettings(
  connection: SavedConnection,
  target: DatabaseTarget,
  release: DatabaseRelease,
  readOnly = false,
) {
  const safety = release.safety ?? defaultSafety();
  const schemas = target.schema
    ? [target.schema]
    : [
        ...new Set(
          release.objects
            .map((item) => item.object.selection.schema)
            .filter((schema): schema is string => Boolean(schema)),
        ),
      ];
  if (connection.kind === "postgres")
    return {
      oracleTimeout: safety.statementTimeoutMs,
      settings: [
        `SET LOCAL lock_timeout = '${safety.lockTimeoutMs}ms'`,
        `SET LOCAL statement_timeout = '${safety.statementTimeoutMs}ms'`,
        `SET LOCAL idle_in_transaction_session_timeout = '${Math.max(safety.statementTimeoutMs, 60000)}ms'`,
        `SET LOCAL search_path = ${schemas.length === 1 ? quoteIdentifier(schemas[0]) : "pg_catalog"}, pg_temp`,
        "SET LOCAL row_security = off",
        ...(readOnly ? ["SET TRANSACTION READ ONLY"] : []),
      ],
    };
  if (schemas.length !== 1)
    throw new Error("Oracle-Deployments benötigen genau ein explizites Zielschema.");
  return {
    oracleTimeout: safety.statementTimeoutMs,
    settings: [
      `ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdentifier(schemas[0])}`,
      `ALTER SESSION SET DDL_LOCK_TIMEOUT = ${Math.ceil(safety.lockTimeoutMs / 1000)}`,
      ...(readOnly ? ["SET TRANSACTION READ ONLY"] : []),
    ],
  };
}

export async function openVersioningSession(
  connection: SavedConnection,
  target: DatabaseTarget,
  release: DatabaseRelease,
  readOnly = false,
) {
  const plan = versioningSessionSettings(connection, target, release, readOnly);
  const transaction = await beginTransaction(
    connection.kind,
    effectiveConnectionString(connection),
    target.database ?? undefined,
  );
  try {
    if (connection.kind === "oracle")
      await versioningOracleTimeout(transaction, plan.oracleTimeout);
    for (const sql of plan.settings)
      await executeInTransaction(transaction, sql, { confirmed: true });
    return transaction;
  } catch (error) {
    try {
      await rollbackTransaction(transaction);
    } catch {
      throw new Error(`${String(error)}; Testsitzung konnte nicht geschlossen werden.`);
    }
    throw error;
  }
}

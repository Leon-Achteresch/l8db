import type { SavedConnection } from "@/lib/connections";
import {
  beginTransaction,
  executeInTransaction,
  executeQuery,
  rollbackTransaction,
  versioningOracleTimeout,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { checksum } from "./model";
import { defaultSafety } from "./safety";
import type { DatabaseRelease, DatabaseTarget, VersioningProject } from "./types";

export const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

function logicalEndpoint(connection: SavedConnection) {
  try {
    const url = new URL(connection.connectionString);
    url.password = "";
    for (const key of [...url.searchParams.keys()])
      if (/password|secret|token/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return connection.connectionString;
  }
}

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
  const edition = typeof row.edition === "string" ? row.edition : null;
  return {
    fingerprint: await checksum(
      JSON.stringify({
        endpoint: logicalEndpoint(connection),
        ssh: connection.ssh ?? null,
        kind: connection.kind,
        database: target.database,
        schema: target.schema ?? null,
        context: row,
      }),
    ),
    physicalKey: await checksum(
      JSON.stringify({
        kind: connection.kind,
        database: row.database,
        server: row.server,
        port: row.port,
        schema: target.ledgerSchema || target.schema,
        edition,
      }),
    ),
    label: `${String(row.user)} @ ${String(row.database)}${row.port ? ` / ${row.port}` : ""}`,
    edition,
  };
}

export async function openVersioningSession(
  connection: SavedConnection,
  target: DatabaseTarget,
  release: DatabaseRelease,
  readOnly = false,
) {
  const transaction = await beginTransaction(
    connection.kind,
    effectiveConnectionString(connection),
    target.database ?? undefined,
  );
  try {
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
    if (connection.kind === "postgres") {
      for (const sql of [
        `SET LOCAL lock_timeout = '${safety.lockTimeoutMs}ms'`,
        `SET LOCAL statement_timeout = '${safety.statementTimeoutMs}ms'`,
        `SET LOCAL idle_in_transaction_session_timeout = '${Math.max(safety.statementTimeoutMs, 60000)}ms'`,
        `SET LOCAL search_path = ${schemas.length === 1 ? `${quoteIdentifier(schemas[0])}, ` : ""}pg_catalog, pg_temp`,
        "SET LOCAL row_security = off",
        ...(readOnly ? ["SET TRANSACTION READ ONLY"] : []),
      ])
        await executeInTransaction(transaction, sql, { confirmed: true });
    } else {
      await versioningOracleTimeout(transaction, safety.statementTimeoutMs);
      if (schemas.length !== 1)
        throw new Error("Oracle-Deployments benötigen genau ein explizites Zielschema.");
      await executeInTransaction(
        transaction,
        `ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdentifier(schemas[0])}`,
        { confirmed: true },
      );
      await executeInTransaction(
        transaction,
        `ALTER SESSION SET DDL_LOCK_TIMEOUT = ${Math.ceil(safety.lockTimeoutMs / 1000)}`,
        { confirmed: true },
      );
      if (readOnly)
        await executeInTransaction(transaction, "SET TRANSACTION READ ONLY", { confirmed: true });
    }
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

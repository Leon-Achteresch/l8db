import type { SavedConnection } from "@/lib/connections";
import { executeInTransaction, executeQuery } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { checksum } from "./model";
import type { DatabaseRelease, DatabaseTarget, VersioningProject } from "./types";

const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

export function ledgerTable(project: VersioningProject, target: DatabaseTarget): string {
  const schema = target.schema || project.objects[0]?.selection.schema;
  if (!schema) throw new Error("Ein verwaltetes Schema wird für die Deployment-Historie benötigt.");
  return `${quote(schema)}."L8DB_VERSIONING_STATE"`;
}

function query(connection: SavedConnection, target: DatabaseTarget, sql: string) {
  if (connection.readOnly && !/^SELECT\b/.test(sql))
    throw new Error("Die Zielverbindung ist schreibgeschützt.");
  return executeQuery(
    connection.kind,
    effectiveConnectionString(connection),
    sql,
    target.database ?? undefined,
    { confirmed: true },
  );
}

export async function releaseHash(release: DatabaseRelease) {
  return checksum(JSON.stringify(release));
}

export async function readLedger(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
) {
  const result = await query(
    connection,
    target,
    `SELECT "RELEASE_ID", "RELEASE_HASH", "LEASE", "STATUS" FROM ${ledgerTable(project, target)} WHERE "PROJECT_ID" = ${literal(project.id)}`,
  );
  return result.rows[0] as
    | { RELEASE_ID: string; RELEASE_HASH: string; LEASE: string | null; STATUS: string }
    | undefined;
}

export async function baselineLedger(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  release: DatabaseRelease,
  reconcile: boolean,
) {
  const table = ledgerTable(project, target);
  const varchar = project.kind === "oracle" ? "VARCHAR2" : "VARCHAR";
  try {
    await query(
      connection,
      target,
      `CREATE TABLE ${table} ("PROJECT_ID" ${varchar}(100) PRIMARY KEY, "RELEASE_ID" ${varchar}(100) NOT NULL, "RELEASE_HASH" ${varchar}(64) NOT NULL, "LEASE" ${varchar}(64), "STATUS" ${varchar}(20) NOT NULL)`,
    );
  } catch (error) {
    if (!/already exists|bereits|ORA-00955|42P07/i.test(String(error))) throw error;
  }
  const current = await readLedger(connection, project, target);
  const hash = await releaseHash(release);
  if (!current) {
    await query(
      connection,
      target,
      `INSERT INTO ${table} ("PROJECT_ID", "RELEASE_ID", "RELEASE_HASH", "STATUS") VALUES (${literal(project.id)}, ${literal(release.id)}, ${literal(hash)}, 'ready')`,
    );
    return;
  }
  if (!reconcile) {
    if (current.RELEASE_HASH !== hash || current.STATUS !== "ready" || current.LEASE)
      throw new Error(
        "Die Datenbank hat bereits einen anderen oder ungeklärten Deployment-Stand. Erst abgleichen.",
      );
    return;
  }
  const leasePredicate = current.LEASE ? `"LEASE" = ${literal(current.LEASE)}` : '"LEASE" IS NULL';
  const result = await query(
    connection,
    target,
    `UPDATE ${table} SET "RELEASE_ID" = ${literal(release.id)}, "RELEASE_HASH" = ${literal(hash)}, "LEASE" = NULL, "STATUS" = 'ready' WHERE "PROJECT_ID" = ${literal(project.id)} AND "RELEASE_HASH" = ${literal(current.RELEASE_HASH)} AND ${leasePredicate}`,
  );
  if (result.rows_affected !== 1) throw new Error("Deployment-Stand wurde inzwischen geändert.");
}

export async function acquireLease(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  release: DatabaseRelease,
  lease: string,
) {
  const result = await query(
    connection,
    target,
    `UPDATE ${ledgerTable(project, target)} SET "LEASE" = ${literal(lease)}, "STATUS" = 'running' WHERE "PROJECT_ID" = ${literal(project.id)} AND "RELEASE_HASH" = ${literal(await releaseHash(release))} AND "LEASE" IS NULL AND "STATUS" = 'ready'`,
  );
  if (result.rows_affected !== 1)
    throw new Error(
      "Ein anderes Deployment läuft oder die Datenbank wurde bereits aktualisiert. Stand neu prüfen.",
    );
}

export async function advanceLedger(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  release: DatabaseRelease,
  lease: string,
  transaction?: string,
) {
  const sql = `UPDATE ${ledgerTable(project, target)} SET "RELEASE_ID" = ${literal(release.id)}, "RELEASE_HASH" = ${literal(await releaseHash(release))} WHERE "PROJECT_ID" = ${literal(project.id)} AND "LEASE" = ${literal(lease)} AND "STATUS" = 'running'`;
  const result = transaction
    ? await executeInTransaction(transaction, sql, { confirmed: true })
    : await query(connection, target, sql);
  if (result.rows_affected !== 1) throw new Error("Deployment-Sperre ist nicht mehr gültig.");
}

export async function finishLease(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  lease: string,
  success: boolean,
) {
  const result = await query(
    connection,
    target,
    `UPDATE ${ledgerTable(project, target)} SET "STATUS" = '${success ? "ready" : "failed"}'${success ? ', "LEASE" = NULL' : ""} WHERE "PROJECT_ID" = ${literal(project.id)} AND "LEASE" = ${literal(lease)}`,
  );
  if (result.rows_affected !== 1)
    throw new Error("Deployment-Sperre konnte nicht abgeschlossen werden.");
}

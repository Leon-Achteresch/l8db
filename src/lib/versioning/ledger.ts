import type { SavedConnection } from "@/lib/connections";
import {
  beginTransaction,
  commitTransaction,
  executeInTransaction,
  executeQuery,
  rollbackTransaction,
} from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { checksum } from "./model";
import type {
  AppliedChange,
  AppliedObject,
  Change,
  DatabaseRelease,
  DatabaseTarget,
  VersioningProject,
} from "./types";

export const LEDGER_READY = "ready2";

const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

export function ledgerTable(
  project: VersioningProject,
  target: DatabaseTarget,
  suffix = "STATE",
): string {
  const schema = target.ledgerSchema || target.schema || project.objects[0]?.selection.schema;
  if (!schema) throw new Error("Ein verwaltetes Schema wird für die Deployment-Historie benötigt.");
  return `${quote(schema)}."L8DB_VERSIONING_${suffix}"`;
}

const missingTable = (error: unknown) =>
  /does not exist|existiert nicht|ORA-00942|42P01/i.test(String(error));
const existingTable = (error: unknown) =>
  /already exists|bereits|ORA-00955|42P07/i.test(String(error));

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
  let current: Awaited<ReturnType<typeof readLedger>>;
  try {
    current = await readLedger(connection, project, target);
  } catch (error) {
    if (!missingTable(error)) throw error;
    try {
      await query(
        connection,
        target,
        `CREATE TABLE ${table} ("PROJECT_ID" ${varchar}(100) PRIMARY KEY, "RELEASE_ID" ${varchar}(100) NOT NULL, "RELEASE_HASH" ${varchar}(64) NOT NULL, "LEASE" ${varchar}(64), "STATUS" ${varchar}(20) NOT NULL)`,
      );
    } catch (error) {
      if (!existingTable(error)) throw error;
    }
    current = await readLedger(connection, project, target);
  }
  await ensureChangeTables(connection, project, target);
  const hash = await releaseHash(release);
  if (!current) {
    await query(
      connection,
      target,
      `INSERT INTO ${table} ("PROJECT_ID", "RELEASE_ID", "RELEASE_HASH", "STATUS") VALUES (${literal(project.id)}, ${literal(release.id)}, ${literal(hash)}, '${LEDGER_READY}')`,
    );
    return;
  }
  if (!reconcile) {
    if (current.RELEASE_HASH !== hash || !isReady(current.STATUS) || current.LEASE)
      throw new Error(
        "Die Datenbank hat bereits einen anderen oder ungeklärten Deployment-Stand. Erst abgleichen.",
      );
    return;
  }
  const leasePredicate = current.LEASE ? `"LEASE" = ${literal(current.LEASE)}` : '"LEASE" IS NULL';
  const result = await query(
    connection,
    target,
    `UPDATE ${table} SET "RELEASE_ID" = ${literal(release.id)}, "RELEASE_HASH" = ${literal(hash)}, "LEASE" = NULL, "STATUS" = '${LEDGER_READY}' WHERE "PROJECT_ID" = ${literal(project.id)} AND "RELEASE_HASH" = ${literal(current.RELEASE_HASH)} AND ${leasePredicate}`,
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
    `UPDATE ${ledgerTable(project, target)} SET "LEASE" = ${literal(lease)}, "STATUS" = 'running' WHERE "PROJECT_ID" = ${literal(project.id)} AND "RELEASE_HASH" = ${literal(await releaseHash(release))} AND "LEASE" IS NULL AND "STATUS" = '${LEDGER_READY}'`,
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
    `UPDATE ${ledgerTable(project, target)} SET "STATUS" = '${success ? LEDGER_READY : "failed"}'${success ? ', "LEASE" = NULL' : ""} WHERE "PROJECT_ID" = ${literal(project.id)} AND "LEASE" = ${literal(lease)}`,
  );
  if (result.rows_affected !== 1)
    throw new Error("Deployment-Sperre konnte nicht abgeschlossen werden.");
}

export const isReady = (status: string | undefined) =>
  status === "ready" || status === LEDGER_READY;

export async function ensureChangeTables(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
) {
  const v = project.kind === "oracle" ? "VARCHAR2" : "VARCHAR";
  for (const [suffix, columns] of [
    [
      "CHANGES",
      `"PROJECT_ID" ${v}(100) NOT NULL, "CHANGE_ID" ${v}(255) NOT NULL, "CHECKSUM" ${v}(64) NOT NULL, "KIND" ${v}(20) NOT NULL, "SOURCE" ${v}(20) NOT NULL, "RELEASE_ID" ${v}(100), "RUN_ID" ${v}(100), "APPLIED_AT" TIMESTAMP NOT NULL, "APPLIED_BY" ${v}(256) NOT NULL, PRIMARY KEY ("PROJECT_ID", "CHANGE_ID")`,
    ],
    [
      "OBJECTS",
      `"PROJECT_ID" ${v}(100) NOT NULL, "OBJECT_ID" ${v}(100) NOT NULL, "APPLIED_HASH" ${v}(64) NOT NULL, "CHANGE_ID" ${v}(255), "APPLIED_AT" TIMESTAMP NOT NULL, PRIMARY KEY ("PROJECT_ID", "OBJECT_ID")`,
    ],
  ]) {
    try {
      await query(
        connection,
        target,
        `CREATE TABLE ${ledgerTable(project, target, suffix)} (${columns})`,
      );
    } catch (error) {
      if (!existingTable(error))
        throw new Error(
          `Kontrolltabelle L8DB_VERSIONING_${suffix} fehlt und kann nicht angelegt werden. In Produktion legt der DBA sie im Kontrollschema an: ${String(error)}`,
        );
    }
  }
}

export interface ChangeLedger {
  changes: Map<string, AppliedChange>;
  objects: Map<string, AppliedObject>;
}

export async function readChangeLedger(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
): Promise<ChangeLedger | null> {
  const id = literal(project.id);
  let rows: Record<string, unknown>[];
  try {
    rows = (
      await query(
        connection,
        target,
        `SELECT 'c' AS "T", "CHANGE_ID" AS "ID", "CHECKSUM" AS "H", "KIND" AS "K", "SOURCE" AS "S", "RELEASE_ID" AS "R" FROM ${ledgerTable(project, target, "CHANGES")} WHERE "PROJECT_ID" = ${id} UNION ALL SELECT 'o', "OBJECT_ID", "APPLIED_HASH", NULL, NULL, "CHANGE_ID" FROM ${ledgerTable(project, target, "OBJECTS")} WHERE "PROJECT_ID" = ${id}`,
      )
    ).rows;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return parseChangeLedger(rows);
}

export function parseChangeLedger(rows: Record<string, unknown>[]): ChangeLedger {
  const changes = new Map<string, AppliedChange>();
  const objects = new Map<string, AppliedObject>();
  for (const row of rows) {
    const key = String(row.ID);
    const reference = row.R === null || row.R === undefined ? null : String(row.R);
    if (row.T === "o") objects.set(key, { id: key, hash: String(row.H), change: reference });
    else
      changes.set(key, {
        id: key,
        checksum: String(row.H),
        kind: row.K === "repeatable" ? "repeatable" : "versioned",
        source: String(row.S) as AppliedChange["source"],
        release: reference,
      });
  }
  return { changes, objects };
}

const sqlValue = (value: string | null) => (value === null ? "NULL" : literal(value));

export function insertStatements(
  kind: VersioningProject["kind"],
  table: string,
  columns: string[],
  rows: (string | null)[][],
  raw: string[] = [],
  batch = 100,
) {
  const names = [...columns, ...raw.map((entry) => entry.split("=")[0])]
    .map((name) => quote(name))
    .join(", ");
  const expressions = raw.map((entry) => entry.slice(entry.indexOf("=") + 1));
  const statements: string[] = [];
  for (let index = 0; index < rows.length; index += batch) {
    const values = rows
      .slice(index, index + batch)
      .map((row) => [...row.map(sqlValue), ...expressions].join(", "));
    statements.push(
      kind === "oracle"
        ? `INSERT ALL ${values.map((entry) => `INTO ${table} (${names}) VALUES (${entry})`).join(" ")} SELECT 1 FROM dual`
        : `INSERT INTO ${table} (${names}) VALUES ${values.map((entry) => `(${entry})`).join(", ")}`,
    );
  }
  return statements;
}

export function changeRows(
  project: VersioningProject,
  target: DatabaseTarget,
  changes: Pick<Change, "id" | "checksum" | "kind" | "release">[],
  source: AppliedChange["source"],
  release: string | null,
  run: string | null,
) {
  const oracle = project.kind === "oracle";
  return insertStatements(
    project.kind,
    ledgerTable(project, target, "CHANGES"),
    ["PROJECT_ID", "CHANGE_ID", "CHECKSUM", "KIND", "SOURCE", "RELEASE_ID", "RUN_ID"],
    changes.map((change) => [
      project.id,
      change.id,
      change.checksum,
      change.kind,
      source,
      change.release ?? release,
      run,
    ]),
    [
      `APPLIED_AT=${oracle ? "SYS_EXTRACT_UTC(SYSTIMESTAMP)" : "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')"}`,
      `APPLIED_BY=${oracle ? "SYS_CONTEXT('USERENV','SESSION_USER')" : "session_user"}`,
    ],
  );
}

export function objectRows(
  project: VersioningProject,
  target: DatabaseTarget,
  objects: AppliedObject[],
) {
  const oracle = project.kind === "oracle";
  return insertStatements(
    project.kind,
    ledgerTable(project, target, "OBJECTS"),
    ["PROJECT_ID", "OBJECT_ID", "APPLIED_HASH", "CHANGE_ID"],
    objects.map((entry) => [project.id, entry.id, entry.hash, entry.change]),
    [
      `APPLIED_AT=${oracle ? "SYS_EXTRACT_UTC(SYSTIMESTAMP)" : "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')"}`,
    ],
  );
}

export async function writeChangeLedger(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  statements: string[],
  replaceObjects: string[] = [],
  finish?: string,
) {
  const transaction = await beginTransaction(
    connection.kind,
    effectiveConnectionString(connection),
    target.database ?? undefined,
  );
  try {
    for (let index = 0; index < replaceObjects.length; index += 500)
      await executeInTransaction(
        transaction,
        `DELETE FROM ${ledgerTable(project, target, "OBJECTS")} WHERE "PROJECT_ID" = ${literal(project.id)} AND "OBJECT_ID" IN (${replaceObjects
          .slice(index, index + 500)
          .map(literal)
          .join(", ")})`,
        { confirmed: true },
      );
    for (const sql of statements) await executeInTransaction(transaction, sql, { confirmed: true });
    if (finish) {
      const result = await executeInTransaction(transaction, finish, { confirmed: true });
      if (result.rows_affected !== 1)
        throw new Error("Deployment-Stand wurde inzwischen geändert. Neu planen.");
    }
    await commitTransaction(transaction);
  } catch (error) {
    await rollbackTransaction(transaction).catch(() => undefined);
    throw error;
  }
}

export async function adoptLedger(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  release: DatabaseRelease,
  changes: Change[],
  objects: AppliedObject[],
) {
  await ensureChangeTables(connection, project, target);
  const hash = await releaseHash(release);
  await writeChangeLedger(
    connection,
    project,
    target,
    [
      ...changeRows(project, target, changes, "migrated", release.id, null),
      ...objectRows(project, target, objects),
    ],
    objects.map((entry) => entry.id),
    `UPDATE ${ledgerTable(project, target)} SET "STATUS" = '${LEDGER_READY}' WHERE "PROJECT_ID" = ${literal(project.id)} AND "RELEASE_HASH" = ${literal(hash)} AND "STATUS" = 'ready' AND "LEASE" IS NULL`,
  );
}

import { type DashboardFile, parseDashboard, serializeDashboard } from "@/lib/dashboard-file";
import type { DatabaseKind } from "@/lib/db/providers";
import type { QueryResult } from "@/lib/db/types";
import { quoteSqlString } from "@/lib/export";
import type { Dashboard } from "./model";

export const SHARED_DASHBOARD_TABLE = "l8_dashboards";

const SUPPORTED: ReadonlySet<DatabaseKind> = new Set([
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "oracle",
  "duckdb",
]);
const BIND_PARAMS: ReadonlySet<DatabaseKind> = new Set(["postgres", "oracle"]);
const MISSING_TABLE =
  /does not exist|doesn't exist|no such table|invalid object name|ORA-00942|Table with name .* does not exist/i;

export type SqlRunner = (sql: string, params?: string[]) => Promise<QueryResult>;

export interface SharedDashboardEntry {
  id: string;
  name: string;
  updatedAt: number;
}

export function supportsSharedDashboards(kind: DatabaseKind | null | undefined): boolean {
  return Boolean(kind && SUPPORTED.has(kind));
}

export function createSharedTableSql(kind: DatabaseKind): string {
  const table = SHARED_DASHBOARD_TABLE;
  if (kind === "mssql")
    return `IF OBJECT_ID(N'${table}', N'U') IS NULL CREATE TABLE ${table} (id NVARCHAR(64) PRIMARY KEY, name NVARCHAR(255) NOT NULL, content NVARCHAR(MAX) NOT NULL, updated_at BIGINT NOT NULL)`;
  if (kind === "oracle")
    return `BEGIN EXECUTE IMMEDIATE 'CREATE TABLE ${table} (id VARCHAR2(64) PRIMARY KEY, name NVARCHAR2(255) NOT NULL, content NCLOB NOT NULL, updated_at NUMBER(19) NOT NULL)'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;`;
  const content = kind === "mysql" ? "LONGTEXT" : "TEXT";
  return `CREATE TABLE IF NOT EXISTS ${table} (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, content ${content} NOT NULL, updated_at BIGINT NOT NULL)`;
}

function run(kind: DatabaseKind, runner: SqlRunner, sql: string, params: string[]) {
  if (BIND_PARAMS.has(kind)) return runner(sql, params);
  return runner(sql.replace(/\$(\d+)/g, (_, index) => quoteSqlString(params[index - 1], kind)));
}

function field(row: Record<string, unknown>, name: string): unknown {
  return row[name] ?? row[name.toUpperCase()];
}

function missingTable(error: unknown): boolean {
  return MISSING_TABLE.test(String(error instanceof Error ? error.message : error));
}

export async function listSharedDashboards(runner: SqlRunner): Promise<SharedDashboardEntry[]> {
  try {
    const result = await runner(
      `SELECT id, name, updated_at FROM ${SHARED_DASHBOARD_TABLE} ORDER BY updated_at DESC`,
    );
    return result.rows.map((row) => ({
      id: String(field(row, "id")),
      name: String(field(row, "name") ?? ""),
      updatedAt: Number(field(row, "updated_at")) || 0,
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function loadSharedDashboard(
  kind: DatabaseKind,
  runner: SqlRunner,
  id: string,
): Promise<DashboardFile> {
  const result = await run(
    kind,
    runner,
    `SELECT content FROM ${SHARED_DASHBOARD_TABLE} WHERE id = $1`,
    [id],
  );
  const content = result.rows[0] ? field(result.rows[0], "content") : undefined;
  if (typeof content !== "string")
    throw new Error("Dashboard nicht mehr in der Datenbank vorhanden");
  return parseDashboard(content);
}

export async function saveSharedDashboard(
  kind: DatabaseKind,
  runner: SqlRunner,
  id: string,
  dashboard: Dashboard,
): Promise<void> {
  const values = [dashboard.name.slice(0, 255), serializeDashboard(dashboard), id];
  const stamp = Math.trunc(Date.now());
  let exists = false;
  try {
    const found = await run(
      kind,
      runner,
      `SELECT id FROM ${SHARED_DASHBOARD_TABLE} WHERE id = $1`,
      [id],
    );
    exists = found.rows.length > 0;
  } catch (error) {
    if (!missingTable(error)) throw error;
    await runner(createSharedTableSql(kind));
  }
  await run(
    kind,
    runner,
    exists
      ? `UPDATE ${SHARED_DASHBOARD_TABLE} SET name = $1, content = $2, updated_at = ${stamp} WHERE id = $3`
      : `INSERT INTO ${SHARED_DASHBOARD_TABLE} (name, content, updated_at, id) VALUES ($1, $2, ${stamp}, $3)`,
    values,
  );
}

export async function deleteSharedDashboard(
  kind: DatabaseKind,
  runner: SqlRunner,
  id: string,
): Promise<void> {
  await run(kind, runner, `DELETE FROM ${SHARED_DASHBOARD_TABLE} WHERE id = $1`, [id]);
}

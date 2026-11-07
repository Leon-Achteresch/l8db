import { saveWorkbenchRecord, workbenchScope } from "./records";

export interface SqlState {
  sql: string;
  editorId: string;
  source: "manual" | "ai" | "success";
}
export function sqlStateScope(connectionId: string, database: string | null, editorId: string) {
  return JSON.stringify([workbenchScope(connectionId, database), editorId]);
}
export function saveSqlCheckpoint(scope: string, name: string, value: SqlState) {
  if (value.sql.length > 450_000)
    throw new Error("Der SQL-Stand ist zu groß (maximal 450.000 Zeichen).");
  if (!value.sql.trim()) throw new Error("Der SQL-Stand ist leer.");
  return saveWorkbenchRecord({ kind: "checkpoint", scope, name, value });
}
export async function recordSuccessfulSql(
  connectionId: string,
  database: string | null,
  editorId: string,
  sql: string,
) {
  if (!sql.trim() || sql.length > 450_000 || typeof indexedDB === "undefined") return;
  const scope = sqlStateScope(connectionId, database, editorId);
  await saveWorkbenchRecord(
    {
      id: `success:${scope}`,
      kind: "success",
      scope,
      name: "Letzter erfolgreicher SQL-Stand",
      value: { sql, editorId, source: "success" } satisfies SqlState,
    },
    true,
  );
}

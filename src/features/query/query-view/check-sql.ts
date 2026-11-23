import { toast } from "sonner";

import { validateSql } from "@/lib/db";
import { type QueryRunTarget, resolveQueryRunTarget } from "@/lib/query-run-target";
import { effectiveConnectionString } from "@/lib/ssh";

import type { QueryViewConnection } from "./types";

interface CheckSqlParams {
  sql: string;
  selectedSql: string;
  cursorOffset: number;
  runTarget: QueryRunTarget;
  blankLines: boolean;
  connection: QueryViewConnection;
  database: string | null;
}

export type CheckSqlOutcome =
  | { status: "skipped" }
  | { status: "ok" }
  | { status: "error"; message: string; target: string };

export async function checkSql({
  sql,
  selectedSql,
  cursorOffset,
  runTarget,
  blankLines,
  connection,
  database,
}: CheckSqlParams): Promise<CheckSqlOutcome> {
  if (!connection) {
    toast.warning("Keine Verbindung.");
    return { status: "skipped" };
  }
  const target = resolveQueryRunTarget(sql, selectedSql, cursorOffset, runTarget, connection.kind, {
    blankLines,
    sqlOnly: true,
  });
  if (!target.trim()) {
    const atCursor = runTarget === "selection-or-statement" && !selectedSql.trim();
    toast.warning(
      atCursor ? "Kein prüfbares Statement an der Cursorposition." : "Kein prüfbares Statement.",
    );
    return { status: "skipped" };
  }
  try {
    await validateSql(
      connection.kind,
      effectiveConnectionString(connection),
      target,
      database ?? undefined,
    );
  } catch (err) {
    const message = String(err);
    toast.error("Prüfung fehlgeschlagen", { description: message.split("\n", 1)[0] });
    return { status: "error", message, target };
  }
  toast.success("Fehlerfrei geprüft — nichts wurde übernommen.");
  return { status: "ok" };
}

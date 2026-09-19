import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery, validateSql } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useObjectDraft } from "@/lib/hooks/use-object-draft";
import { effectiveConnectionString } from "@/lib/ssh";

export type SqlEditState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "applying" }
  | { status: "checked" }
  | { status: "applied"; time: number }
  | { status: "error"; scope: "check" | "apply"; message: string };

export interface SqlObjectEdit {
  editing: boolean;
  sql: string;
  setSql: (value: string) => void;
  state: SqlEditState;
  start: () => void;
  cancel: () => void;
  check: () => Promise<void>;
  apply: () => Promise<void>;
}

export function useSqlObjectEdit(
  label: string,
  source: string,
  objectKey: string,
  onApplied?: () => Promise<void>,
): SqlObjectEdit {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [draft, setDraft, clearSavedDraft] = useObjectDraft(objectKey, label, source);
  const editing = draft !== null;
  const sql = draft ?? "";
  const setSql = setDraft;
  const [state, setState] = useState<SqlEditState>({ status: "idle" });

  const start = useCallback(() => {
    setSql(source);
    setState({ status: "idle" });
  }, [source, setSql]);

  const cancel = useCallback(() => {
    setDraft(null);
    setState({ status: "idle" });
  }, [setDraft]);

  const check = useCallback(async () => {
    if (!connection) return;
    setState({ status: "checking" });
    try {
      await validateSql(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
      );
      setState({ status: "checked" });
    } catch (e) {
      setState({ status: "error", scope: "check", message: String(e) });
    }
  }, [connection, database, sql]);

  const apply = useCallback(async () => {
    if (!connection) return;
    setState({ status: "applying" });
    try {
      const result = await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
      );
      setState({ status: "applied", time: result.execution_time_ms });
      toast.success(`${label} in der Datenbank gespeichert`, {
        description: "Das Objekt existiert jetzt in dieser Form in der Datenbank.",
      });
      await onApplied?.();
      await queryClient.invalidateQueries({ queryKey: ["function-definition"] });
      await queryClient.invalidateQueries({ queryKey: ["functions"] });
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
      clearSavedDraft(sql);
    } catch (e) {
      setState({ status: "error", scope: "apply", message: String(e) });
    }
  }, [connection, database, label, queryClient, sql, clearSavedDraft, onApplied]);

  return { editing, sql, setSql, state, start, cancel, check, apply };
}

export { OpenInQueryEditorButton } from "./sql-object-edit/open-in-query-editor-button";
export { SqlEditActions } from "./sql-object-edit/sql-edit-actions";
export { SqlEditFeedback } from "./sql-object-edit/sql-edit-feedback";
export { SqlEditHint } from "./sql-object-edit/sql-edit-hint";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { useObjectDraft } from "@/lib/hooks/use-object-draft";
import { effectiveConnectionString } from "@/lib/ssh";
import { applyRoutine, checkRoutine, type RoutineEdit } from "./sql-object-edit/replace-routine";

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
  schema?: string,
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

  const routineEdit = useCallback(
    (): RoutineEdit | null =>
      connection
        ? {
            kind: connection.kind,
            connectionString: effectiveConnectionString(connection),
            database: database ?? undefined,
            schema,
            original: source,
            definition: sql,
          }
        : null,
    [connection, database, schema, source, sql],
  );

  const check = useCallback(async () => {
    const edit = routineEdit();
    if (!edit) return;
    setState({ status: "checking" });
    try {
      await checkRoutine(edit);
      setState({ status: "checked" });
    } catch (e) {
      setState({ status: "error", scope: "check", message: String(e) });
    }
  }, [routineEdit]);

  const apply = useCallback(async () => {
    const edit = routineEdit();
    if (!edit) return;
    setState({ status: "applying" });
    try {
      const { time, warning } = await applyRoutine(edit);
      setState({ status: "applied", time });
      if (warning) toast.warning(warning);
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
  }, [routineEdit, label, queryClient, sql, clearSavedDraft, onApplied]);

  return { editing, sql, setSql, state, start, cancel, check, apply };
}

export { OpenInQueryEditorButton } from "./sql-object-edit/open-in-query-editor-button";
export { SqlEditActions } from "./sql-object-edit/sql-edit-actions";
export { SqlEditFeedback } from "./sql-object-edit/sql-edit-feedback";
export { SqlEditHint } from "./sql-object-edit/sql-edit-hint";

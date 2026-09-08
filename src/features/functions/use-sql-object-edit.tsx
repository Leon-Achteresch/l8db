import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircleIcon,
  DatabaseIcon,
  LoaderIcon,
  PencilIcon,
  ShieldCheckIcon,
  SquareArrowOutUpRightIcon,
  UndoIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery, validateSql } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

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

export function useSqlObjectEdit(label: string, source: string): SqlObjectEdit {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [sql, setSql] = useState("");
  const [state, setState] = useState<SqlEditState>({ status: "idle" });

  const start = useCallback(() => {
    setEditing(true);
    setSql(source);
    setState({ status: "idle" });
  }, [source]);

  const cancel = useCallback(() => {
    setEditing(false);
    setSql("");
    setState({ status: "idle" });
  }, []);

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
      await queryClient.invalidateQueries({ queryKey: ["function-definition"] });
      await queryClient.invalidateQueries({ queryKey: ["functions"] });
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
      setEditing(false);
      setSql("");
    } catch (e) {
      setState({ status: "error", scope: "apply", message: String(e) });
    }
  }, [connection, database, label, queryClient, sql]);

  return { editing, sql, setSql, state, start, cancel, check, apply };
}

export function SqlEditActions({ edit }: { edit: SqlObjectEdit }) {
  const busy = edit.state.status === "checking" || edit.state.status === "applying";

  if (!edit.editing) {
    return (
      <Button variant="outline" size="xs" onClick={edit.start}>
        <PencilIcon data-icon="inline-start" />
        Bearbeiten
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="xs" onClick={edit.cancel} disabled={busy}>
        <UndoIcon data-icon="inline-start" />
        Abbrechen
      </Button>
      <Button
        variant="outline"
        size="xs"
        onClick={() => void edit.check()}
        disabled={busy}
        title="Kompiliert testweise und macht die Änderung sofort rückgängig — nichts wird gespeichert."
      >
        {edit.state.status === "checking" ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : (
          <ShieldCheckIcon data-icon="inline-start" />
        )}
        Nur prüfen
      </Button>
      <Button
        variant="default"
        size="xs"
        onClick={() => void edit.apply()}
        disabled={busy}
        title="Führt das SQL wirklich aus — das Objekt existiert danach so in der Datenbank."
      >
        {edit.state.status === "applying" ? (
          <LoaderIcon data-icon="inline-start" className="animate-spin" />
        ) : (
          <DatabaseIcon data-icon="inline-start" />
        )}
        In Datenbank speichern
      </Button>
    </>
  );
}

export function SqlEditHint() {
  return (
    <div className="border-b bg-amber-500/5 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300">
      Änderungen sind noch nicht in der Datenbank. <b>Nur prüfen</b> kompiliert testweise und rollt
      zurück, <b>In Datenbank speichern</b> führt das SQL aus und ersetzt das Objekt dauerhaft.
    </div>
  );
}

export function SqlEditFeedback({ state }: { state: SqlEditState }) {
  if (state.status === "idle" || state.status === "checking" || state.status === "applying") {
    return null;
  }

  if (state.status === "error") {
    return (
      <div className="flex items-start gap-2 border-t bg-destructive/5 px-4 py-2.5">
        <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-destructive">
            {state.scope === "check"
              ? "Prüfung fehlgeschlagen — nichts wurde gespeichert"
              : "Speichern fehlgeschlagen — Objekt in der Datenbank unverändert"}
          </span>
          <pre className="whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
            {state.message}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 border-t bg-emerald-500/5 px-4 py-2.5">
      <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
        {state.status === "checked"
          ? "Fehlerfrei kompilierbar — noch nicht gespeichert, die Änderung wurde zurückgerollt."
          : `In der Datenbank gespeichert (${state.time} ms) — das Objekt existiert jetzt so.`}
      </span>
    </div>
  );
}

export function OpenInQueryEditorButton({ sql, title }: { sql: string; title: string }) {
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={!sql}
      onClick={() => openQueryTabWithSql(sql, title)}
      title="Öffnet den Quelltext als neuen SQL-Tab im Query-Editor."
    >
      <SquareArrowOutUpRightIcon data-icon="inline-start" />
      Im Query-Editor
    </Button>
  );
}

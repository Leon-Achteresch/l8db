import { CheckCircleIcon, XCircleIcon } from "lucide-react";
import type { SqlEditState } from "../use-sql-object-edit";

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

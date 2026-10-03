import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { TransferOutcome, TransferProgress } from "@/lib/db";

const PHASE_LABELS: Record<TransferProgress["progress"]["phase"], string> = {
  pre: "Struktur wird angelegt",
  data: "Daten werden geladen",
  post: "Schlüssel, Indizes und Fremdschlüssel werden angelegt",
  finalize: "Sequenzen werden nachgezogen",
};

export function TransferRunStatus({
  running,
  progress,
  outcome,
  onCancel,
}: {
  running: boolean;
  progress: TransferProgress["progress"] | null;
  outcome: TransferOutcome | null;
  onCancel: () => void;
}) {
  if (running) {
    const tables = progress?.tables ?? 0;
    const done = progress ? progress.tableIndex : 0;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Spinner className="size-3.5 shrink-0" />
            <span className="truncate">
              {progress ? PHASE_LABELS[progress.phase] : "Transfer wird vorbereitet"}
              {progress?.table && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {progress.table}
                </span>
              )}
            </span>
          </span>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
        <Progress value={tables > 0 ? (done / tables) * 100 : 0} />
        <span className="text-xs tabular-nums text-muted-foreground">
          Tabelle {Math.min(done + 1, tables)} von {tables} · {progress?.rows ?? 0} Zeilen in dieser
          Tabelle · {progress?.totalRows ?? 0} gesamt
        </span>
      </div>
    );
  }
  if (!outcome) return null;
  if (outcome.committed)
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
          <CircleCheckIcon className="size-4" />
          {outcome.rows} Zeilen in {outcome.tables.length} Tabellen übertragen und verifiziert.
        </span>
        {outcome.warnings.map((warning) => (
          <span key={warning} className="text-xs text-amber-700 dark:text-amber-400">
            {warning}
          </span>
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="flex items-center gap-2 font-medium text-destructive">
        <CircleXIcon className="size-4" />
        Transfer fehlgeschlagen.{" "}
        {outcome.rolledBack
          ? outcome.atomic
            ? "Die Zieltransaktion wurde zurückgerollt; das Ziel ist unverändert."
            : "Alle angelegten Objekte wurden wieder entfernt."
          : "Das Ziel ist nicht vollständig bereinigt."}
      </span>
      {outcome.error && (
        <pre className="font-mono text-xs whitespace-pre-wrap text-destructive">
          {outcome.error}
        </pre>
      )}
      {outcome.leftovers.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Manuell zu entfernen:</p>
          <ul className="list-disc pl-4 font-mono">
            {outcome.leftovers.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

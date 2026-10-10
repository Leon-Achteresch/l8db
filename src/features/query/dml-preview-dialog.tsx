import { AlertTriangleIcon, LoaderIcon, OctagonAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryResultTable } from "@/features/query/query-result-table";
import type { DmlPreviewState } from "@/features/query/query-view/use-dml-preview";
import type { DatabaseKind } from "@/lib/db";
import type { DmlKind } from "@/lib/dml-preview";

const KIND_LABELS: Record<DmlKind, string> = {
  update: "UPDATE",
  delete: "DELETE",
  insert_select: "INSERT … SELECT",
  merge: "MERGE",
};

const NUMBER = new Intl.NumberFormat("de-DE");

interface DmlPreviewDialogProps {
  state: DmlPreviewState | null;
  kind?: DatabaseKind;
  connectionName?: string;
  database: string | null;
  warnThreshold: number;
  onRun: () => void;
  onCancel: () => void;
  onStop: () => void;
}

export function DmlPreviewDialog({
  state,
  kind,
  connectionName,
  database,
  warnThreshold,
  onRun,
  onCancel,
  onStop,
}: DmlPreviewDialogProps) {
  const derivation = state?.derivation;
  const plan = derivation?.status === "ready" ? derivation : null;
  const count = state?.outcome?.count ?? null;
  const sample = state?.outcome?.sample ?? null;
  const loading = Boolean(state?.phase);
  const overThreshold = count !== null && count > warnThreshold;
  const risky = Boolean(derivation?.whereMissing || overThreshold || state?.production);
  const title = derivation?.kind
    ? `Vorschau: ${KIND_LABELS[derivation.kind]}${plan ? ` auf ${plan.table}` : ""}`
    : "Vorschau";
  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-4xl" data-testid="dml-preview-dialog">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {title}
            {state?.production && <Badge variant="destructive">Produktion</Badge>}
          </DialogTitle>
          <DialogDescription>
            {connectionName ?? "Verbindung"} · {database ?? "Standard-Datenbank"}. Die Vorschau
            liest nur, sperrt keine Zeilen und verändert nichts.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-3 overflow-auto">
          {derivation?.whereMissing && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              <OctagonAlertIcon className="mt-0.5 size-4 shrink-0" />
              Keine WHERE-Klausel: Die Anweisung betrifft alle Zeilen der Tabelle.
            </div>
          )}

          {derivation?.status === "unavailable" && (
            <div className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                Vorschau nicht möglich
              </p>
              <p className="text-muted-foreground">{derivation.reason}</p>
              <p className="text-xs text-muted-foreground">
                Die Anweisung kann trotzdem nach Bestätigung ausgeführt werden.
              </p>
            </div>
          )}

          {plan && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {loading ? (
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderIcon className="size-4 animate-spin" />
                  {state?.phase === "count" ? "Zähle betroffene Zeilen…" : "Lade Beispielzeilen…"}
                </span>
              ) : count !== null ? (
                <span
                  className={
                    overThreshold || derivation?.whereMissing
                      ? "text-2xl font-semibold text-destructive"
                      : "text-2xl font-semibold"
                  }
                  data-testid="dml-preview-count"
                >
                  {NUMBER.format(count)} {count === 1 ? "Zeile" : "Zeilen"} betroffen
                </span>
              ) : null}
              {sample && count !== null && count > 0 && (
                <span className="text-xs text-muted-foreground">
                  Beispiel: {NUMBER.format(sample.rows.length)} von {NUMBER.format(count)}
                </span>
              )}
            </div>
          )}

          {overThreshold && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              Mehr als {NUMBER.format(warnThreshold)} Zeilen betroffen.
            </div>
          )}

          {plan?.note && <p className="text-xs text-muted-foreground">{plan.note}</p>}

          {state?.note && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{state.note}</p>
          )}

          {plan?.assignments
            .filter((assignment) => !assignment.previewed)
            .map((assignment) => (
              <p key={assignment.column} className="text-xs text-muted-foreground">
                Neuer Wert für <span className="font-mono">{assignment.column}</span> wird nicht
                berechnet, weil er kein einfacher Ausdruck ist.
              </p>
            ))}

          {state?.error && (
            <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              Vorschau fehlgeschlagen: {state.error}
            </p>
          )}

          {state?.stopped && <p className="text-sm text-muted-foreground">Vorschau abgebrochen.</p>}

          {sample && sample.columns.length > 0 && (
            <div className="h-72 overflow-hidden rounded-md border">
              <QueryResultTable result={sample} isLoading={false} error={null} kind={kind} />
            </div>
          )}

          {derivation && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-xs">
              {derivation.statement}
            </pre>
          )}
        </div>

        <DialogFooter>
          {loading && (
            <Button variant="ghost" onClick={onStop}>
              Vorschau stoppen
            </Button>
          )}
          <Button variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button variant={risky ? "destructive" : "default"} disabled={loading} onClick={onRun}>
            Ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

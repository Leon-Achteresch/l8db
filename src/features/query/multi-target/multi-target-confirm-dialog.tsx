import { LoaderIcon, OctagonAlertIcon } from "lucide-react";
import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import type { TargetRun } from "@/lib/multi-target";
import type { PendingConfirmation } from "./use-multi-target-run";

const NUMBER = new Intl.NumberFormat("de-DE");

function countLabel(run: TargetRun | undefined): string {
  if (!run) return "";
  if (run.status === "queued" || run.status === "running") return "…";
  if (run.status === "error") return "Fehler";
  if (run.status === "cancelled") return "abgebrochen";
  const row = run.result?.rows[0];
  const column = run.result?.columns[0];
  const value = row && column ? Number(row[column]) : Number.NaN;
  return Number.isFinite(value) ? `${NUMBER.format(value)} Zeilen` : "";
}

interface MultiTargetConfirmDialogProps {
  pending: PendingConfirmation | null;
  labels: ReadonlyMap<string, string>;
  canCount: boolean;
  onCount: () => void;
  onAnswer: (accepted: boolean) => void;
}

export function MultiTargetConfirmDialog({
  pending,
  labels,
  canCount,
  onCount,
  onAnswer,
}: MultiTargetConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const gate = pending?.gate;
  const production = new Set(gate?.production.map((target) => target.id));
  const required = gate?.requiresProductionConfirmation ? String(gate.allowed.length) : null;
  const matches = required === null || typed.trim() === required;
  const finish = (accepted: boolean) => {
    setTyped("");
    onAnswer(accepted && matches);
  };
  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && finish(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Schreibende Anweisung auf {gate?.allowed.length ?? 0} Zielen ausführen?
          </DialogTitle>
          <DialogDescription>
            Die Anweisung verändert Daten oder Struktur und läuft auf jedem aufgeführten Ziel
            einzeln. Ein Fehler auf einem Ziel stoppt die anderen nicht.
          </DialogDescription>
        </DialogHeader>
        {gate && gate.production.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            <OctagonAlertIcon className="size-4 shrink-0" />
            {gate.production.length} Ziele liegen in Produktion.
          </div>
        )}
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-xs">
          {pending?.sql}
        </pre>
        <ul
          className="max-h-64 overflow-auto rounded-md border text-xs"
          data-testid="multi-target-confirm-targets"
        >
          {gate?.allowed.map((target) => (
            <li
              key={target.id}
              className={
                production.has(target.id)
                  ? "flex items-center gap-2 border-b bg-destructive/5 px-3 py-1.5 last:border-b-0"
                  : "flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
              }
            >
              <span className="min-w-0 flex-1 truncate">{labels.get(target.id) ?? target.id}</span>
              {production.has(target.id) && (
                <Badge variant="destructive" className="text-[10px]">
                  Produktion
                </Badge>
              )}
              <span className="w-24 text-right tabular-nums text-muted-foreground">
                {countLabel(pending?.counts?.[target.id])}
              </span>
            </li>
          ))}
          {gate?.rejected.map(({ target, reason }) => (
            <li key={target.id} className="border-b px-3 py-1.5 text-destructive last:border-b-0">
              <span className="font-medium">{labels.get(target.id) ?? target.id}</span>: abgelehnt.{" "}
              {reason}
            </li>
          ))}
        </ul>
        {canCount && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={pending?.counting}
              onClick={onCount}
            >
              {pending?.counting && <LoaderIcon className="size-3 animate-spin" />}
              Betroffene Zeilen je Ziel zählen
            </Button>
            {pending?.countReason && <span>{pending.countReason}</span>}
          </div>
        )}
        {required !== null && (
          <div className="grid gap-1.5 text-sm">
            <label htmlFor="multi-target-confirmation">
              Zum Bestätigen die Anzahl der Ziele <strong className="font-mono">{required}</strong>{" "}
              eingeben
            </label>
            <Input
              id="multi-target-confirmation"
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches) finish(true);
              }}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>
            Abbrechen
          </Button>
          <Button variant="destructive" disabled={!matches} onClick={() => finish(true)}>
            Auf {gate?.allowed.length ?? 0} Zielen ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

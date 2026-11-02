import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, LoaderIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { checkCompareTarget, runComparePlan } from "@/lib/compare-apply";
import { buildCompareApplyPlan, destructiveStatements } from "@/lib/compare-apply-plan";
import type { CompareSideSelection } from "@/lib/compare-types";
import type { SavedConnection } from "@/lib/connections";

interface Props {
  connection: SavedConnection | null;
  side: CompareSideSelection;
  baseline: string;
  draft: string | null;
  disabled: boolean;
  onApplied: () => void;
  onDiscard: () => void;
  targetLabel: "Quelle" | "Ziel";
}

export function CompareApplyDialog({
  connection,
  side,
  baseline,
  draft,
  disabled,
  onApplied,
  onDiscard,
  targetLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "checked" | "applying" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [statements, setStatements] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const destructive = destructiveStatements(statements);
  const confirmed = destructive.length === 0 || confirmation === side.objectName;
  const checked = useRef<string | null>(null);
  const pending = useRef(false);
  const fingerprint = JSON.stringify([connection, side, baseline, draft]);
  const latest = useRef(fingerprint);
  latest.current = fingerprint;
  const queryClient = useQueryClient();
  const busy = status === "checking" || status === "applying";

  const check = async () => {
    if (!connection || draft === null || pending.current) return;
    pending.current = true;
    setOpen(true);
    setStatus("checking");
    setError(null);
    setStatements([]);
    setConfirmation("");
    setConfirmDiscard(false);
    checked.current = null;
    try {
      const plan = buildCompareApplyPlan(connection.kind, side, baseline, draft);
      setStatements(plan);
      await checkCompareTarget(connection, side, baseline);
      await runComparePlan(connection, side, plan, false);
      if (latest.current !== fingerprint)
        throw new Error("Der Entwurf hat sich geändert. Bitte erneut prüfen.");
      checked.current = fingerprint;
      setStatus("checked");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    } finally {
      pending.current = false;
    }
  };

  const apply = async () => {
    if (!connection || pending.current || checked.current !== fingerprint || !confirmed) return;
    pending.current = true;
    setStatus("applying");
    try {
      await checkCompareTarget(connection, side, baseline);
      if (latest.current !== fingerprint)
        throw new Error("Der Entwurf hat sich geändert. Bitte erneut prüfen.");
      await runComparePlan(connection, side, statements, true);
      checked.current = null;
      onApplied();
      setOpen(false);
      setStatus("idle");
      toast.success(`Änderungen in der ${targetLabel} gespeichert.`);
      void queryClient.invalidateQueries();
    } catch (cause) {
      checked.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    } finally {
      pending.current = false;
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 gap-1 px-2 text-xs"
        disabled={
          disabled ||
          !connection ||
          connection.readOnly ||
          draft === null ||
          draft === baseline ||
          busy
        }
        disabledReason={
          busy
            ? "Prüfung läuft bereits"
            : !connection
              ? "Keine Zielverbindung ausgewählt"
              : connection.readOnly
                ? "Zielverbindung ist schreibgeschützt"
                : draft === null
                  ? "Zuerst den Entwurf öffnen und bearbeiten"
                  : draft === baseline
                    ? "Keine Änderungen im Entwurf"
                    : undefined
        }
        onClick={() => void check()}
      >
        <CheckIcon className="size-3" />
        {targetLabel} prüfen
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Übernahmen bestätigen</DialogTitle>
            <DialogDescription>
              {targetLabel}: {connection?.name} · {side.database} · {side.schema}.{side.objectName}
            </DialogDescription>
          </DialogHeader>
          {statements.length > 0 && (
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              {statements.join("\n\n")}
            </pre>
          )}
          {destructive.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
              <p className="font-medium text-destructive">
                {destructive.length === 1
                  ? "Eine Anweisung löscht Spalten samt Daten:"
                  : `${destructive.length} Anweisungen löschen Spalten samt Daten:`}
              </p>
              <ul className="max-h-24 overflow-auto font-mono text-[11px]">
                {destructive.map((statement) => (
                  <li key={statement} className="truncate">
                    {statement}
                  </li>
                ))}
              </ul>
              <Label className="flex flex-col items-start gap-1 text-xs font-normal">
                <span>
                  Zum Ausführen den Objektnamen <strong>{side.objectName}</strong> eingeben
                </span>
                <Input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="h-8 font-mono text-xs"
                  aria-label="Objektnamen bestätigen"
                  disabled={busy}
                />
              </Label>
            </div>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderIcon className="size-4 animate-spin" />
              {status === "checking"
                ? `Prüfung in der ${targetLabel} läuft…`
                : "Änderungen werden ausgeführt…"}
            </p>
          )}
          {status === "checked" && checked.current === fingerprint && (
            <p role="status" className="text-sm text-emerald-600">
              Prüfung erfolgreich. Bereit zur Bestätigung.
            </p>
          )}
          {error && (
            <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant={confirmDiscard ? "destructive" : "ghost"}
              disabled={busy}
              onClick={() => {
                if (!confirmDiscard) {
                  setConfirmDiscard(true);
                  return;
                }
                onDiscard();
                setOpen(false);
              }}
            >
              {confirmDiscard ? "Entwurf wirklich verwerfen" : "Entwurf verwerfen"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Zurück zum Entwurf
            </Button>
            {status === "error" && (
              <Button variant="outline" onClick={() => void check()}>
                Erneut prüfen
              </Button>
            )}
            <Button
              variant={destructive.length > 0 ? "destructive" : "default"}
              disabled={
                busy || status !== "checked" || checked.current !== fingerprint || !confirmed
              }
              disabledReason={
                busy
                  ? "Wird gerade ausgeführt"
                  : status !== "checked" || checked.current !== fingerprint
                    ? "Entwurf zuerst erfolgreich prüfen"
                    : "Objektnamen zur Bestätigung eingeben"
              }
              onClick={() => void apply()}
            >
              Bestätigen und ausführen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

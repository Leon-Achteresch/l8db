import { ArrowRightIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { TransferCinema } from "./cinema/transfer-cinema";
import { TransferEndpoint } from "./transfer-endpoint";
import { TransferPlanDetails } from "./transfer-plan";
import { TransferRunStatus } from "./transfer-run-status";
import { TransferSchemas } from "./transfer-schemas";
import { useTransfer } from "./transfer-view/use-transfer";

export function TransferView() {
  const transfer = useTransfer();
  const { plan } = transfer;
  const conflicts = plan?.conflicts ?? [];
  const canStart = Boolean(plan) && conflicts.length === 0 && !transfer.running;
  const hint = transfer.readOnly
    ? "Die Zielverbindung ist schreibgeschützt."
    : transfer.sameEndpoint
      ? "Quelle und Ziel sind identisch. Bitte ein anderes Zielschema wählen."
      : transfer.error
        ? transfer.error
        : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6">
      <TransferCinema
        open={transfer.cinema}
        source={transfer.sourceConnection}
        target={transfer.targetConnection}
        sourceDatabase={transfer.source.database}
        targetDatabase={transfer.target.database}
        plan={plan}
        progress={transfer.progress}
        outcome={transfer.outcome}
        running={transfer.running}
        startedAt={transfer.startedAt}
        onCancel={transfer.cancel}
        onClose={transfer.closeCinema}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Transfer</h1>
          <p className="text-sm text-muted-foreground">
            Kopiert Schemas mit Struktur und Daten in eine andere Verbindung, auch über
            Datenbankfamilien hinweg. Alles oder nichts: Bei einem Fehler bleibt das Ziel
            unverändert.
          </p>
        </div>

        <div className="flex flex-col divide-y rounded-2xl border bg-card shadow-xs">
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
            <TransferEndpoint
              title="Quelle"
              value={transfer.source}
              onChange={transfer.setSource}
              onSchemas={transfer.setSourceSchemas}
            />
            <ArrowRightIcon className="hidden size-4 shrink-0 self-center text-muted-foreground md:mt-7 md:block" />
            <TransferEndpoint
              title="Ziel"
              value={transfer.target}
              onChange={transfer.setTarget}
              onSchemas={transfer.setTargetSchemas}
            />
          </div>

          {transfer.sourceConnection && (
            <div className="p-4">
              {transfer.sourceSchemas.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Schemas gefunden.</p>
              ) : (
                <TransferSchemas
                  schemas={transfer.sourceSchemas}
                  existing={transfer.targetSchemas}
                  selected={transfer.schemas}
                  mapping={transfer.mapping}
                  onToggle={transfer.toggleSchema}
                  onSelectAll={transfer.setSchemas}
                  onMap={transfer.setMapping}
                />
              )}
            </div>
          )}

          {transfer.crossFamily && (
            <div className="flex items-center gap-3 px-4 py-3">
              <Switch
                id="transfer-fold"
                checked={transfer.foldNames}
                onCheckedChange={transfer.setFoldNames}
              />
              <Label htmlFor="transfer-fold" className="text-sm font-normal">
                Namen an die Konvention des Ziels anpassen
              </Label>
            </div>
          )}

          {(transfer.running || transfer.outcome) && (
            <div className="p-4">
              <TransferRunStatus
                running={transfer.running}
                progress={transfer.progress}
                outcome={transfer.outcome}
                onCancel={transfer.cancel}
              />
            </div>
          )}

          {!transfer.running && (plan || transfer.planning || hint) && (
            <div className="flex flex-col gap-3 p-4">
              {hint && <p className="text-xs text-destructive">{hint}</p>}
              {transfer.planning && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {transfer.planning}
                </p>
              )}
              {conflicts.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <p className="font-medium">
                    Im Ziel existieren bereits {conflicts.length} Objekte. Der Transfer überschreibt
                    nichts; bitte ein anderes Zielschema wählen oder die Objekte entfernen.
                  </p>
                  <p className="mt-1 font-mono">{conflicts.slice(0, 30).join(", ")}</p>
                </div>
              )}
              {plan && <TransferPlanDetails plan={plan} />}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 p-4">
            <span className="text-xs text-muted-foreground">
              {plan
                ? plan.atomic
                  ? "Läuft in einer Zieltransaktion."
                  : "Angelegte Objekte werden bei einem Fehler wieder entfernt."
                : transfer.outcome?.committed
                  ? "Abgeschlossen. Für einen weiteren Transfer die Auswahl ändern."
                  : "Quelle, Ziel und mindestens ein Schema wählen."}
            </span>
            <Button onClick={() => void transfer.start()} disabled={!canStart}>
              {transfer.running ? <Spinner className="size-4" /> : <PlayIcon className="size-4" />}
              Transfer starten
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { ArrowRightLeftIcon, LoaderIcon, PlayIcon, SearchCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TransferEndpointPicker } from "./transfer-endpoint-picker";
import { TransferPlanSummary } from "./transfer-plan-summary";
import { TransferRunStatus } from "./transfer-run-status";
import { TransferSchemaList } from "./transfer-schema-list";
import { TransferSchemaMapping } from "./transfer-schema-mapping";
import { useTransfer } from "./transfer-view/use-transfer";

export function TransferView() {
  const transfer = useTransfer();
  const { plan } = transfer;
  const blocked = !plan || plan.conflicts.length > 0 || transfer.running;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <ArrowRightLeftIcon className="size-4" />
          Transfer
        </h1>
        <p className="text-xs text-muted-foreground">
          Kopiert Schemas vollständig mit Struktur und Daten in eine andere Verbindung, auch
          zwischen Datenbankfamilien. Das Ziel wird nie teilweise befüllt: Entweder wird alles
          übertragen und geprüft, oder der Zustand vor dem Transfer wird wiederhergestellt.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <TransferEndpointPicker
          title="Quelle"
          value={transfer.source}
          onChange={transfer.setSource}
        >
          {(schemas, loading) => (
            <TransferSchemaList
              schemas={schemas}
              loading={loading}
              selected={transfer.schemas}
              onChange={transfer.setSchemas}
            />
          )}
        </TransferEndpointPicker>
        <TransferEndpointPicker title="Ziel" value={transfer.target} onChange={transfer.setTarget}>
          {(schemas) => (
            <TransferSchemaMapping
              sources={transfer.schemas}
              existing={schemas}
              mapping={transfer.mapping}
              onChange={transfer.setMapping}
            />
          )}
        </TransferEndpointPicker>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {transfer.crossFamily && (
          <div className="flex items-center gap-2">
            <Switch
              id="transfer-fold"
              checked={transfer.foldNames}
              onCheckedChange={transfer.setFoldNames}
            />
            <Label htmlFor="transfer-fold" className="text-xs">
              Namen an Zielkonvention anpassen
            </Label>
          </div>
        )}
        {transfer.readOnly && (
          <span className="text-xs text-destructive">Die Zielverbindung ist schreibgeschützt.</span>
        )}
        {transfer.sameEndpoint && (
          <span className="text-xs text-destructive">
            Quelle und Ziel sind identisch; bitte ein anderes Zielschema wählen.
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void transfer.analyze()}
            disabled={!transfer.ready || Boolean(transfer.planning)}
          >
            {transfer.planning ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <SearchCheckIcon className="size-3.5" />
            )}
            Analysieren
          </Button>
          <Button size="sm" onClick={() => void transfer.start()} disabled={blocked}>
            {transfer.running ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
            Transfer starten
          </Button>
        </div>
      </div>
      {transfer.planning && <p className="text-xs text-muted-foreground">{transfer.planning}</p>}
      {transfer.error && (
        <pre className="rounded-md border border-destructive/40 bg-destructive/10 p-2 font-mono text-xs whitespace-pre-wrap text-destructive">
          {transfer.error}
        </pre>
      )}
      <TransferRunStatus
        running={transfer.running}
        progress={transfer.progress}
        outcome={transfer.outcome}
        onCancel={transfer.cancel}
      />
      {plan && <TransferPlanSummary plan={plan} />}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, FileCodeIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getDatabaseOverview, type SchemaSize } from "@/lib/db";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";
import { TransferCinema } from "./cinema/transfer-cinema";
import { TransferEndpoint } from "./transfer-endpoint";
import { TransferPlanDetails } from "./transfer-plan";
import { TransferRunStatus } from "./transfer-run-status";
import { TransferSchemas } from "./transfer-schemas";
import { TransferSummary } from "./transfer-summary";
import { useTransfer } from "./transfer-view/use-transfer";

export function TransferView() {
  const transfer = useTransfer();
  const { plan } = transfer;
  const [planTab, setPlanTab] = useState<string | null>(null);
  const conflicts = plan?.conflicts ?? [];
  const canStart = Boolean(plan) && conflicts.length === 0 && !transfer.running;
  const hint = transfer.readOnly
    ? "Die Zielverbindung ist schreibgeschützt."
    : transfer.sameEndpoint
      ? "Quelle und Ziel sind identisch. Bitte ein anderes Zielschema wählen."
      : transfer.error
        ? transfer.error
        : null;
  const sourceId = transfer.source.connectionId;
  const overview = useQuery({
    queryKey: ["transfer-overview", sourceId, transfer.source.database],
    enabled: Boolean(sourceId),
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const ready = await prepareConnection(sourceId as string);
      const result = await getDatabaseOverview(
        ready.kind,
        effectiveConnectionString(ready),
        transfer.source.database ?? undefined,
      );
      return Object.fromEntries(result.schemas.map((entry) => [entry.schema, entry]));
    },
  });
  const sizes: Record<string, SchemaSize> = overview.data ?? {};
  const status = transfer.planning
    ? transfer.planning
    : plan
      ? conflicts.length
        ? `${conflicts.length} Objekte im Ziel bereits vorhanden`
        : `${plan.tables.length} Tabellen bereit`
      : transfer.outcome?.committed
        ? "Abgeschlossen. Für einen weiteren Transfer die Auswahl ändern."
        : "Quelle, Ziel und mindestens ein Schema wählen.";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {transfer.planning && <Spinner className="size-3.5 shrink-0" />}
          <span className="truncate tabular-nums">{status}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!plan} onClick={() => setPlanTab("script")}>
            <FileCodeIcon />
            Skript anzeigen
          </Button>
          <Button size="sm" onClick={() => void transfer.start()} disabled={!canStart}>
            {transfer.running ? <Spinner className="size-3.5" /> : <PlayIcon />}
            Übertragung starten
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="flex shrink-0 items-stretch gap-2">
          <TransferEndpoint
            title="Quelle"
            value={transfer.source}
            onChange={transfer.setSource}
            onSchemas={transfer.setSourceSchemas}
          />
          <span className="flex size-8 shrink-0 items-center justify-center self-center rounded-full border bg-card text-muted-foreground">
            <ArrowRightIcon className="size-4" />
          </span>
          <TransferEndpoint
            title="Ziel"
            value={transfer.target}
            onChange={transfer.setTarget}
            onSchemas={transfer.setTargetSchemas}
          />
        </div>
        {hint && (
          <p role="alert" className="shrink-0 text-xs text-destructive">
            {hint}
          </p>
        )}
        {(transfer.running || transfer.outcome) && (
          <div className="shrink-0 rounded-xl border bg-card p-3">
            <TransferRunStatus
              running={transfer.running}
              progress={transfer.progress}
              outcome={transfer.outcome}
              onCancel={transfer.cancel}
            />
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-3">
          {transfer.sourceConnection ? (
            <TransferSchemas
              schemas={transfer.sourceSchemas}
              existing={transfer.targetSchemas}
              selected={transfer.schemas}
              mapping={transfer.mapping}
              plan={plan}
              sizes={sizes}
              onToggle={transfer.toggleSchema}
              onSelectAll={transfer.setSchemas}
              onMap={transfer.setMapping}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
              Quelle wählen
            </div>
          )}
          <TransferSummary
            plan={plan}
            selected={transfer.schemas}
            sizes={sizes}
            crossFamily={transfer.crossFamily}
            foldNames={transfer.foldNames}
            onFoldNames={transfer.setFoldNames}
            onShowPlan={setPlanTab}
          />
        </div>
      </div>
      {plan && (
        <TransferPlanDetails
          plan={plan}
          open={planTab !== null}
          tab={planTab ?? "tables"}
          onOpenChange={(open) => {
            if (!open) setPlanTab(null);
          }}
        />
      )}
    </div>
  );
}

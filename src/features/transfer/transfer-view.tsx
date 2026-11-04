import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, FileCodeIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useConnectionsStore } from "@/lib/connections";
import { getDatabaseOverview, type SchemaSize } from "@/lib/db";
import { useDbSelectionStore } from "@/lib/db-selection";
import { prepareConnection } from "@/lib/prepare-connection";
import { effectiveConnectionString } from "@/lib/ssh";
import { activateConnectionWithToast } from "@/lib/ssh/activation";
import { useTableTabs } from "@/lib/table-tabs";
import { TransferCinema } from "./cinema/transfer-cinema";
import { TransferEndpoint } from "./transfer-endpoint";
import { TransferPlanDetails } from "./transfer-plan";
import { TransferReplaceDialog } from "./transfer-replace-dialog";
import { TransferRunStatus } from "./transfer-run-status";
import { TransferSchemas } from "./transfer-schemas";
import { TransferSummary } from "./transfer-summary";
import { useTransfer } from "./transfer-view/use-transfer";

export function TransferView() {
  const transfer = useTransfer();
  const { plan } = transfer;
  const [planTab, setPlanTab] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const navigate = useNavigate();
  const openInEditor = async (sql: string) => {
    const target = transfer.targetConnection;
    if (!target) return;
    if (
      useConnectionsStore.getState().activeId !== target.id &&
      !(await activateConnectionWithToast(target.id))
    )
      return;
    if (transfer.target.database)
      useDbSelectionStore.getState().setDatabase(target.id, transfer.target.database);
    const id = useTableTabs.getState().openQueryTabWithSql(sql, `Transfer nach ${target.name}`);
    setPlanTab(null);
    void navigate({ to: "/query/$id", params: { id } });
  };
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
        : plan.replace
          ? `${plan.tables.length} Tabellen bereit, Ziel wird überschrieben`
          : plan.content === "structure"
            ? `${plan.tables.length} Tabellen bereit, nur Struktur`
            : plan.content === "data"
              ? `${plan.tables.length} Tabellen bereit, nur Daten`
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
          <Button
            variant="ghost"
            size="sm"
            disabled={!plan}
            disabledReason="Noch kein Übertragungsplan"
            onClick={() => setPlanTab("script")}
          >
            <FileCodeIcon />
            Skript anzeigen
          </Button>
          <Button
            size="sm"
            onClick={() =>
              plan?.replace && plan.replaced.length > 0
                ? setConfirmReplace(true)
                : void transfer.start()
            }
            disabled={!canStart}
            disabledReason={
              transfer.running
                ? "Übertragung läuft bereits"
                : !plan
                  ? "Noch kein Übertragungsplan – Quelle und Ziel auswählen"
                  : `${conflicts.length} Konflikt(e) zuerst lösen`
            }
          >
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
            focus={Boolean(transfer.source.connectionId) && !transfer.target.connectionId}
          />
        </div>
        {transfer.planning && (
          <div
            role="status"
            className="flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm"
          >
            <Spinner className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-medium">{transfer.planning}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              Liest Struktur aus Quelle und Ziel, noch nichts wird geändert
            </span>
          </div>
        )}
        {hint && (
          <p role="alert" className="shrink-0 text-xs text-destructive">
            {hint}
          </p>
        )}
        {(transfer.running || transfer.outcome) && (
          <div className="shrink-0 rounded-xl border bg-card p-3">
            <TransferRunStatus
              content={plan?.content ?? transfer.content}
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
              scope={transfer.scope}
              connectionId={transfer.sourceConnection.id}
              database={transfer.source.database}
              schemas={transfer.sourceSchemas ?? []}
              existing={transfer.targetSchemas ?? []}
              loading={transfer.sourceSchemas === null}
              selected={transfer.schemas}
              mapping={transfer.mapping}
              defaultTarget={transfer.defaultTarget}
              tables={transfer.tables}
              objects={transfer.objects}
              pickObjects={transfer.pickObjects}
              content={transfer.content}
              plan={plan}
              sizes={sizes}
              onToggle={transfer.toggleSchema}
              onSelectAll={transfer.setSchemas}
              onMap={transfer.setMapping}
              onTables={transfer.setTables}
              onObjects={transfer.setObjects}
              onContent={transfer.setContent}
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
            canReplace={transfer.canReplace}
            replace={transfer.replace}
            onReplace={transfer.setReplace}
            onShowPlan={setPlanTab}
          />
        </div>
      </div>
      {plan && (
        <TransferReplaceDialog
          plan={plan}
          open={confirmReplace}
          onOpenChange={setConfirmReplace}
          onConfirm={() => {
            setConfirmReplace(false);
            void transfer.start();
          }}
        />
      )}
      {plan && (
        <TransferPlanDetails
          plan={plan}
          open={planTab !== null}
          tab={planTab ?? "tables"}
          targetName={transfer.targetConnection?.name ?? "Ziel"}
          busy={transfer.running || Boolean(transfer.planning)}
          onOpenEditor={(sql) => void openInEditor(sql)}
          onOpenChange={(open) => {
            if (!open) setPlanTab(null);
          }}
        />
      )}
    </div>
  );
}

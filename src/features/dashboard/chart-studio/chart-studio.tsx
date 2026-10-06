import { BookmarkIcon, ChartColumnIcon, CopyIcon, EllipsisIcon, Trash2Icon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IconMenu, IconMenuContent, IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { makeChartFile } from "@/lib/chart-file";
import { useDashboardWorkspaceStore } from "@/lib/dashboard-workspace";
import {
  applyOptions,
  CHARTS,
  type ChartTab,
  chartFits,
  type Dataset,
  datasetShape,
  emptySimple,
  type SimpleDataset,
  useChartTabsStore,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { ChartBuilderPreview } from "../chart-builder-preview";
import { ChartDataStep } from "../chart-data-step";
import {
  autoTitle,
  type ChartDraft,
  canFinishDraft,
  finishedDraft,
  patchDraftDataset,
} from "../chart-draft";
import { ChartQuestionStep } from "../chart-question-step";
import { ChartStyleStep } from "../chart-style-step";
import { ChartVisualBuilder } from "../chart-visual-builder";
import { useDatasetColumns, useDatasetSql, useDebounced, useSqlQuery } from "../use-dataset-query";
import { DataModelCanvas } from "./data-model-canvas";
import { type SourceTable, StudioSourceList } from "./studio-source-list";
import { type StudioStep, StudioSteps } from "./studio-steps";

function usedRefs(simple: SimpleDataset): Set<string> {
  return new Set(
    [
      simple.dimension?.column,
      simple.dimension2,
      simple.dateColumn,
      ...simple.metrics.map((m) => m.column),
      ...simple.filters.map((f) => f.column),
    ].filter((ref): ref is string => Boolean(ref)),
  );
}

export function ChartStudio({
  tab,
  variablesBar,
  onSave,
  onDelete,
  onDuplicate,
  onClose,
}: {
  tab: ChartTab;
  variablesBar: React.ReactNode;
  onSave: (draft: ChartDraft, close: boolean) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onClose: () => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("dashboard.studio");
  const change = useChartTabsStore((s) => s.change);
  const draft: ChartDraft = { widget: tab.widget, dataset: tab.dataset };
  const { widget, dataset } = draft;
  const simple = dataset.simple;
  const expert = dataset.mode === "expert";
  const [section, setSection] = useState(expert ? "source" : "data");
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<SourceTable | null>(null);
  const builderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { columns, joins } = useDatasetColumns(simple);
  const liveSql = useDatasetSql(dataset, widget.period);
  const sql = useDebounced(liveSql, expert ? 1200 : 500);
  const preview = useSqlQuery(sql);
  const shape = useMemo(() => datasetShape(dataset), [dataset]);
  const used = useMemo(() => usedRefs(simple), [simple]);

  const latest = (): ChartDraft =>
    useChartTabsStore.getState().tabs.find((t) => t.id === tab.id) ?? draft;
  const patchDataset = (patch: Partial<Dataset>) =>
    change(tab.id, patchDraftDataset(latest(), patch));
  const patchWidget = (patch: Partial<Widget>) => {
    const current = latest();
    change(tab.id, { dataset: current.dataset, widget: { ...current.widget, ...patch } });
  };
  const setSimple = (next: SimpleDataset) => patchDataset({ simple: next });

  const title = autoTitle(dataset, widget);
  const finished = finishedDraft(draft);
  const canFinish = canFinishDraft(draft);
  const problem = chartFits(widget.chart, applyOptions(shape, [], widgetOptions(widget)).shape);

  const nodeKeys = useMemo(
    () =>
      new Set([
        ...(simple.table ? [`${simple.schema}.${simple.table}`] : []),
        ...(simple.joins ?? []).map((j) => `${j.schema}.${j.table}`),
      ]),
    [simple.schema, simple.table, simple.joins],
  );
  const fkJoins = useMemo(() => joins.filter((j) => !j.manual), [joins]);
  const fkTables = useMemo(() => new Set(fkJoins.map((j) => `${j.schema}.${j.table}`)), [fkJoins]);
  const columnNames = useMemo(
    () => columns.filter((c) => c.column).map((c) => c.column ?? ""),
    [columns],
  );

  const pickSource = (source: SourceTable) => {
    if (!simple.table) {
      setSimple({ ...emptySimple(), schema: source.schema, table: source.table });
      return;
    }
    if (nodeKeys.has(`${source.schema}.${source.table}`)) return;
    setPending(source);
    canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const steps: StudioStep[] = expert
    ? [
        {
          id: "source",
          label: "SQL",
          detail: dataset.sql.trim() ? "geschrieben" : "fehlt",
          done: Boolean(dataset.sql.trim()),
        },
        {
          id: "data",
          label: "Zuordnen",
          detail: shape.metrics.length ? `${shape.metrics.length} Kennzahlen` : "Kennzahl wählen",
          done: shape.metrics.length > 0,
        },
        { id: "style", label: "Darstellung", detail: CHARTS[widget.chart].label, done: !problem },
      ]
    : [
        {
          id: "data:source",
          label: "Quelle",
          detail: simple.table || "Tabelle wählen",
          done: Boolean(simple.table),
        },
        {
          id: "data:joins",
          label: "Verknüpfen",
          detail: simple.joins?.length
            ? `${simple.joins.length} ${simple.joins.length === 1 ? "Tabelle" : "Tabellen"}`
            : "optional",
          done: Boolean(simple.joins?.length),
          optional: true,
        },
        {
          id: "data:metrics",
          label: "Kennzahl",
          detail: shape.metrics[0]?.label ?? "wählen",
          done: shape.metrics.length > 0 && Boolean(simple.table),
        },
        {
          id: "data:dimension",
          label: "Aufteilung",
          detail: shape.dimension
            ? "gesetzt"
            : CHARTS[widget.chart].dim === "required"
              ? "fehlt"
              : "Gesamtwert",
          done:
            Boolean(simple.table) &&
            (Boolean(shape.dimension) || CHARTS[widget.chart].dim !== "required"),
        },
        {
          id: "style",
          label: "Darstellung",
          detail: CHARTS[widget.chart].label,
          done: Boolean(simple.table) && !problem,
        },
      ];

  const jump = (id: string) => {
    const [tabId, part] = id.split(":");
    setSection(tabId);
    requestAnimationFrame(() => {
      const target =
        part === "source" || part === "joins"
          ? canvasRef.current
          : part
            ? builderRef.current?.querySelector(
                `[aria-label="${part === "metrics" ? "Kennzahlen" : "Aufteilung"}"]`,
              )
            : null;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (target instanceof HTMLElement) {
        target.classList.add("ai-flash");
        setTimeout(() => target.classList.remove("ai-flash"), 1300);
      }
    });
  };

  const close = () => {
    if (tab.dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    onClose();
  };

  return (
    <div ref={feature.ref} className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <ChartColumnIcon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <input
            aria-label="Chart-Titel"
            value={widget.title}
            placeholder={title || "Unbenannter Chart"}
            onChange={(event) => patchWidget({ title: event.target.value })}
            className="w-72 max-w-full rounded-md bg-transparent px-1 text-base font-semibold tracking-tight outline-none placeholder:text-foreground/70 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            {tab.isNew ? "Neuer Chart" : "Chart bearbeiten"}
            {tab.dirty && (
              <span className="text-amber-600 dark:text-amber-400">· ungespeichert</span>
            )}
            {feature.isNew && <NewBadge />}
          </p>
        </div>
        <div className="mx-auto min-w-0">
          <StudioSteps steps={steps} onJump={jump} />
        </div>
        <div className="flex items-center gap-2">
          <IconMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <IconMenuContent align="end">
              <IconMenuItem
                icon={<BookmarkIcon />}
                label="In Sammlung speichern"
                disabled={!canFinish}
                onSelect={() => {
                  useDashboardWorkspaceStore
                    .getState()
                    .saveChart(makeChartFile(widget, finished.dataset, widget.title || title));
                  toast.success("Chart in deiner Sammlung gespeichert");
                }}
              />
              {onDuplicate && (
                <IconMenuItem icon={<CopyIcon />} label="Duplizieren" onSelect={onDuplicate} />
              )}
              {onDelete && (
                <>
                  <IconMenuSeparator />
                  <IconMenuItem
                    icon={<Trash2Icon />}
                    label="Löschen"
                    variant="destructive"
                    onSelect={() => {
                      if (window.confirm("Diesen Chart wirklich löschen?")) onDelete();
                    }}
                  />
                </>
              )}
            </IconMenuContent>
          </IconMenu>
          <Button variant="ghost" size="sm" onClick={close}>
            {tab.dirty ? "Verwerfen" : "Schließen"}
          </Button>
          {!tab.isNew && (
            <Button
              variant="outline"
              size="sm"
              disabled={!canFinish || !tab.dirty}
              onClick={() => onSave(finished, false)}
            >
              Speichern
            </Button>
          )}
          <Button size="sm" disabled={!canFinish} onClick={() => onSave(finished, true)}>
            {tab.isNew ? "Zum Dashboard hinzufügen" : "Speichern & schließen"}
          </Button>
        </div>
      </div>
      <div
        className={
          expert
            ? "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]"
            : "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_minmax(340px,420px)]"
        }
      >
        {!expert && (
          <StudioSourceList
            hasBase={Boolean(simple.table)}
            onCanvas={nodeKeys}
            columnNames={columnNames}
            fkTables={fkTables}
            onPick={pickSource}
          />
        )}
        <main className="min-h-0 min-w-0 overflow-y-auto p-5">
          <Tabs value={section} onValueChange={setSection}>
            <TabsList className="mb-5">
              <TabsTrigger value="data">Daten</TabsTrigger>
              <TabsTrigger value="style">Darstellung</TabsTrigger>
              <TabsTrigger value="source">{expert ? "SQL" : "Eigenes SQL"}</TabsTrigger>
            </TabsList>
            <TabsContent value="data" className="space-y-5">
              {expert ? (
                <ChartQuestionStep
                  dataset={dataset}
                  onChange={patchDataset}
                  resultColumns={preview.data?.columns ?? []}
                />
              ) : (
                <>
                  <div ref={canvasRef}>
                    <DataModelCanvas
                      simple={simple}
                      columns={columns}
                      fkJoins={fkJoins}
                      pending={pending}
                      selected={selected}
                      used={used}
                      onPending={setPending}
                      onSelect={setSelected}
                      onChange={setSimple}
                      onPickSource={pickSource}
                    />
                  </div>
                  {simple.table && (
                    <div ref={builderRef}>
                      <ChartVisualBuilder
                        dataset={dataset}
                        onChange={patchDataset}
                        showLibrary={false}
                        selected={selected}
                        onSelectedChange={setSelected}
                      />
                    </div>
                  )}
                </>
              )}
            </TabsContent>
            <TabsContent value="style">
              <ChartStyleStep widget={widget} shape={shape} onChange={patchWidget} />
            </TabsContent>
            <TabsContent value="source">
              <ChartDataStep dataset={dataset} onChange={patchDataset} />
            </TabsContent>
          </Tabs>
        </main>
        <div className="flex min-h-0 flex-col border-l">
          {variablesBar && <div className="border-b px-4 py-2.5">{variablesBar}</div>}
          <ChartBuilderPreview
            widget={finished.widget}
            dataset={finished.dataset}
            query={preview}
            updating={sql !== liveSql}
          />
        </div>
      </div>
    </div>
  );
}

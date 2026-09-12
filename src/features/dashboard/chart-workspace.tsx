import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CHARTS,
  type ChartKind,
  createId,
  type Dashboard,
  datasetShape,
  settle,
  useDashboardsStore,
  type Widget,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { ChartPalette } from "./chart-palette";
import { useDatasetSql, useSqlQuery } from "./use-dataset-query";
import { WidgetCard } from "./widget-card";
import { WidgetSettings } from "./widget-settings";

export function ChartWorkspace({
  dashboard,
  initialWidgetId,
  onWidgetChange,
  selectedDatasetId,
  onDatasetChange,
  onData,
  onLayout,
}: {
  dashboard: Dashboard;
  initialWidgetId?: string;
  onWidgetChange: (id: string) => void;
  selectedDatasetId: string | null;
  onDatasetChange: (id: string) => void;
  onData: () => void;
  onLayout: () => void;
}) {
  const selectedId = initialWidgetId ?? dashboard.widgets[0]?.id ?? "";
  const setSelectedId = onWidgetChange;
  const [adding, setAdding] = useState(dashboard.widgets.length === 0);
  const widget = dashboard.widgets.find((w) => w.id === selectedId) ?? dashboard.widgets[0];
  const dataset = dashboard.datasets.find((d) => d.id === selectedDatasetId) ?? null;
  const chartDataset = dashboard.datasets.find((d) => d.id === widget?.datasetId) ?? null;
  const sql = useDatasetSql(chartDataset, widget?.period ?? "all");
  const query = useSqlQuery(sql);
  const update = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    useDashboardsStore.getState().update(dashboard.id, patch);
  const add = (kind: ChartKind) => {
    const id = createId();
    update((d) => ({
      widgets: [
        ...d.widgets,
        settle(
          {
            id,
            chart: kind,
            datasetId: selectedDatasetId,
            title: "",
            period: "all",
            x: 0,
            y: 0,
            w: CHARTS[kind].w,
            h: CHARTS[kind].h,
          },
          d.widgets,
        ),
      ],
    }));
    setSelectedId(id);
    setAdding(false);
  };
  const change = (patch: Partial<Widget>) =>
    update((d) => ({
      widgets: d.widgets.map((w) => (w.id === widget?.id ? { ...w, ...patch } : w)),
    }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        {dashboard.widgets.map((w, i) => (
          <Button
            key={w.id}
            size="sm"
            variant={!adding && w.id === widget?.id ? "secondary" : "ghost"}
            onClick={() => {
              setSelectedId(w.id);
              setAdding(false);
            }}
          >
            {w.title || `Chart ${i + 1} · ${CHARTS[w.chart].label}`}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          Chart hinzufügen
        </Button>
        <Button size="sm" className="ml-auto" onClick={onLayout}>
          Weiter zum Dashboard →
        </Button>
      </div>
      {adding || !widget ? (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Schritt 2 · Visualisieren</p>
              <h2 className="mt-1 text-xl font-semibold">Was sollen deine Daten erzählen?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Wähle einen Datensatz und eine Darstellung. Mehrere Charts können dieselbe Quelle
                nutzen und unterschiedliche Kennzahlen zeigen.
              </p>
            </div>
            {dataset ? (
              <>
                <Select value={selectedDatasetId ?? ""} onValueChange={onDatasetChange}>
                  <SelectTrigger aria-label="Datensatz für neuen Chart" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dashboard.datasets.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ChartPalette shape={datasetShape(dataset)} locked={false} onAdd={add} />
              </>
            ) : (
              <Button onClick={onData}>Zuerst einen Datensatz vorbereiten</Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-label="Chart-Vorschau" className="workspace-canvas min-w-0 p-6">
            <p className="mb-4 text-xs text-muted-foreground">
              Live-Vorschau · Änderungen werden automatisch gespeichert
            </p>
            <div
              className={cn("mx-auto h-[440px] max-w-3xl", widget.chart === "kpi" && "max-w-md")}
            >
              <WidgetCard key={widget.id} dashboardId={dashboard.id} widgetId={widget.id} preview />
            </div>
            <Button
              className="mt-4"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (widget.datasetId) onDatasetChange(widget.datasetId);
                onData();
              }}
            >
              Datenquelle bearbeiten
            </Button>
            {chartDataset && (
              <Button
                variant="outline"
                size="sm"
                className="ml-2 mt-4"
                onClick={() => {
                  const source = {
                    ...structuredClone(chartDataset),
                    id: createId(),
                    name: `${chartDataset.name} · ${widget.title || CHARTS[widget.chart].label}`,
                  };
                  update((d) => ({
                    datasets: [...d.datasets, source],
                    widgets: d.widgets.map((w) =>
                      w.id === widget.id ? { ...w, datasetId: source.id } : w,
                    ),
                  }));
                  onDatasetChange(source.id);
                  onData();
                }}
              >
                Daten nur für diesen Chart anpassen
              </Button>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Eine eigene Datenauswahl lässt dich Gruppierung und Filter ändern, ohne andere Charts
              zu verändern.
            </p>
          </section>
          <aside
            aria-label="Chart bearbeiten"
            className="min-w-0 space-y-5 overflow-y-auto border-l bg-card pt-5"
          >
            <div className="px-4">
              <h2 className="font-semibold">Chart bearbeiten</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Daten, Kennzahlen und Aussehen an einem Ort.
              </p>
            </div>
            <WidgetSettings
              inline
              open
              onOpenChange={() => {}}
              widget={widget}
              dashboardId={dashboard.id}
              rows={query.data?.rows ?? []}
              onChange={change}
              onRemove={() => {
                update((d) => ({ widgets: d.widgets.filter((w) => w.id !== widget.id) }));
              }}
              onDuplicate={() => {
                const id = createId();
                update((d) => ({
                  widgets: [
                    ...d.widgets,
                    settle(
                      {
                        ...structuredClone(widget),
                        id,
                        title: `${widget.title || CHARTS[widget.chart].label} (Kopie)`,
                      },
                      d.widgets,
                    ),
                  ],
                }));
                setSelectedId(id);
              }}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

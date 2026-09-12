import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newWorksheet, updateWorksheet } from "@/lib/chart-worksheet";
import {
  CHARTS,
  type ChartKind,
  createId,
  type Dashboard,
  settle,
  useDashboardsStore,
} from "@/lib/dashboards";
import { CHART_ICONS } from "./chart-palette";
import { ChartWorksheet } from "./chart-worksheet";

export function ChartWorkspace({
  dashboard,
  selectedWidgetId,
  onWidgetChange,
  onLayout,
}: {
  dashboard: Dashboard;
  selectedWidgetId?: string;
  onWidgetChange: (id: string) => void;
  onLayout: () => void;
}) {
  const widget = dashboard.widgets.find((w) => w.id === selectedWidgetId) ?? dashboard.widgets[0];
  const update = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    useDashboardsStore.getState().update(dashboard.id, patch);
  const add = (kind: ChartKind = "column") => {
    const created = newWorksheet(dashboard, kind);
    update((d) => ({
      widgets: [...d.widgets, created.widget],
      datasets: [...d.datasets, created.dataset],
    }));
    onWidgetChange(created.widget.id);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <nav aria-label="Charts" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {dashboard.widgets.map((w, i) => (
            <Button
              key={w.id}
              size="sm"
              variant={w.id === widget?.id ? "secondary" : "ghost"}
              aria-current={w.id === widget?.id ? "page" : undefined}
              onClick={() => onWidgetChange(w.id)}
            >
              {w.title || `Chart ${i + 1}`}
            </Button>
          ))}
        </nav>
        <Button size="sm" variant="outline" onClick={() => add()}>
          <PlusIcon /> Chart hinzufügen
        </Button>
        {widget && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const id = createId();
                update((d) => {
                  const copy = settle(
                    { ...structuredClone(widget), id, title: `${widget.title || "Chart"} (Kopie)` },
                    d.widgets,
                  );
                  const source = d.datasets.find((dataset) => dataset.id === widget.datasetId);
                  const next = { ...d, widgets: [...d.widgets, copy] };
                  return source
                    ? updateWorksheet(next, id, { dataset: source, widget: copy })
                    : { widgets: next.widgets };
                });
                onWidgetChange(id);
              }}
            >
              Duplizieren
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!window.confirm(`Chart „${widget.title || "Ohne Titel"}“ löschen?`)) return;
                update((d) => ({
                  widgets: d.widgets.filter((w) => w.id !== widget.id),
                  datasets: d.datasets.filter(
                    (dataset) =>
                      dataset.id !== widget.datasetId ||
                      d.widgets.some((w) => w.id !== widget.id && w.datasetId === dataset.id),
                  ),
                }));
              }}
            >
              Löschen
            </Button>
          </>
        )}
        <Button size="sm" onClick={onLayout}>
          Zum Dashboard →
        </Button>
      </div>
      {widget ? (
        <ChartWorksheet key={widget.id} dashboard={dashboard} widget={widget} />
      ) : (
        <div className="grid flex-1 place-items-center overflow-y-auto p-8">
          <div className="max-w-2xl space-y-6">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Dein erster Chart</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                Was möchtest du herausfinden?
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Füge einen Chart hinzu, wähle eine Tabelle oder View und ziehe ihre Felder in den
                Chart. Filter und Berechnungen stellst du direkt dort ein.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["column", "Werte vergleichen", "Zum Beispiel Umsatz pro Land"],
                  ["line", "Entwicklung sehen", "Zum Beispiel Bestellungen pro Monat"],
                  ["donut", "Anteile verstehen", "Zum Beispiel Kunden nach Tarif"],
                  ["kpi", "Eine Zahl im Blick", "Zum Beispiel Anzahl Bestellungen"],
                ] as const
              ).map(([kind, title, hint]) => {
                const Icon = CHART_ICONS[kind];
                return (
                  <button
                    type="button"
                    key={kind}
                    onClick={() => add(kind)}
                    className="space-y-2 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Icon className="size-5 text-primary" />
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                    <span className="block text-xs font-medium">
                      {CHARTS[kind].label} hinzufügen →
                    </span>
                  </button>
                );
              })}
            </div>
            <Button onClick={() => add()}>
              <PlusIcon /> Ersten Chart hinzufügen
            </Button>
            <p className="text-xs text-muted-foreground">
              Den Chart-Typ kannst du jederzeit ändern. Du brauchst keine SQL-Kenntnisse.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

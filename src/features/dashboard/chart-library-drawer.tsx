import { useState } from "react";
import { toast } from "sonner";
import { ResizableDrawer } from "@/components/resizable-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type ChartFile,
  confirmChartSql,
  insertChartFile,
  makeChartFile,
  pickAndReadChart,
  pickAndWriteChart,
} from "@/lib/chart-file";
import { useDashboardWorkspaceStore } from "@/lib/dashboard-workspace";
import { CHARTS, type Dashboard, useDashboardsStore } from "@/lib/dashboards";

export function ChartLibraryDrawer({
  open,
  onOpenChange,
  dashboard,
  onLoaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: Dashboard;
  onLoaded: (id: string) => void;
}) {
  const library = useDashboardWorkspaceStore();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const task = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chart konnte nicht verarbeitet werden");
    } finally {
      setBusy(false);
    }
  };
  const load = (chart: ChartFile, save = false) => {
    if (!confirmChartSql(chart)) return;
    const target = useDashboardsStore.getState().dashboards.find((d) => d.id === dashboard.id);
    if (!target) return;
    const inserted = insertChartFile(target, chart);
    useDashboardsStore.getState().update(target.id, (d) => ({
      datasets: [...d.datasets, inserted.dataset],
      widgets: [...d.widgets, inserted.widget],
      locked: false,
    }));
    if (save) library.saveChart(chart);
    onLoaded(inserted.widget.id);
    onOpenChange(false);
    toast.success("Chart ins Dashboard geladen");
  };
  return (
    <ResizableDrawer
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      title="Gespeicherte Charts"
      description="Charts mit ihrer Datenauswahl speichern und in Dashboards wiederverwenden."
      width={library.drawerWidths.charts}
      onWidthChange={(value) => library.setDrawerWidth("charts", value)}
    >
      <div className="space-y-5 p-4">
        <section className="space-y-3 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">Chart aus Datei laden</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ein gespeicherter Chart enthält seine Darstellung, Felder und Filter. Beim Laden
            entsteht eine eigene Kopie im aktuellen Dashboard.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void task(async () => {
                const chart = await pickAndReadChart();
                if (chart) load(chart, true);
              })
            }
          >
            Aus Datei laden
          </Button>
        </section>
        <div>
          <h3 className="text-sm font-semibold">Deine Chart-Sammlung</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Speichere einen Chart über „In Sammlung speichern“ im Chart-Dialog. Die verwendete
            Tabelle oder View muss in der aktuellen Verbindung vorhanden sein.
          </p>
        </div>
        <Input
          aria-label="Gespeicherte Charts suchen"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Charts suchen…"
        />
        <div className="space-y-2">
          {library.savedCharts
            .filter((chart) => chart.name.toLowerCase().includes(search.toLowerCase()))
            .map((chart) => (
              <article key={chart.id} className="space-y-3 rounded-lg border p-3">
                <div>
                  <h4 className="text-sm font-medium">{chart.name}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {CHARTS[chart.widget.chart].label} ·{" "}
                    {chart.dataset.mode === "simple"
                      ? chart.dataset.simple.table || "Quelle noch offen"
                      : "Erweiterte Datenquelle"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" onClick={() => load(chart)}>
                    Ins Dashboard laden
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void task(async () => {
                        if (
                          await pickAndWriteChart(
                            makeChartFile(chart.widget, chart.dataset, chart.name),
                          )
                        )
                          toast.success("Chart-Datei gespeichert");
                      })
                    }
                  >
                    Datei speichern
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Gespeicherten Chart „${chart.name}“ aus der Sammlung löschen?`,
                        )
                      )
                        library.removeChart(chart.id);
                    }}
                  >
                    Löschen
                  </Button>
                </div>
              </article>
            ))}
          {!library.savedCharts.some((chart) =>
            chart.name.toLowerCase().includes(search.toLowerCase()),
          ) && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Noch keine passenden Charts. Speichere einen Chart im Chart-Dialog oder lade eine
              Chart-Datei.
            </p>
          )}
        </div>
      </div>
    </ResizableDrawer>
  );
}

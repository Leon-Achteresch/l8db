import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CHARTS, useDashboardsStore } from "@/lib/dashboards";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGETS,
  type HomeWidget,
  type HomeWidgetKind,
  placeHomeWidget,
  useHomeLayoutStore,
} from "@/lib/home-layout";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { useSettingsStore } from "@/lib/settings";

const SINGLE_KINDS = (Object.keys(HOME_WIDGETS) as HomeWidgetKind[]).filter(
  (kind) => HOME_WIDGETS[kind].single,
);

export function HomeAddWidgetMenu({ connectionId }: { connectionId: string }) {
  const widgets = useHomeLayoutStore((state) => state.layouts[connectionId] ?? DEFAULT_HOME_LAYOUT);
  const setLayout = useHomeLayoutStore((state) => state.setLayout);
  const database = useActiveDatabase();
  const caps = useActiveCapabilities();
  const easyMode = useSettingsStore((state) => state.easyMode);
  const allDashboards = useDashboardsStore((state) => state.dashboards);
  const dashboards = allDashboards.filter(
    (dashboard) =>
      dashboard.connectionId === connectionId &&
      (!dashboard.database || dashboard.database === database) &&
      dashboard.widgets.length > 0,
  );
  const saved = useSavedQueriesStore((state) => state.queries);
  const available = SINGLE_KINDS.filter(
    (kind) =>
      (kind !== "storage" || caps.overview) &&
      (kind !== "er-diagram" || !easyMode) &&
      !widgets.some((widget) => widget.kind === kind),
  );

  const add = (kind: HomeWidgetKind, extra?: Partial<HomeWidget>) => {
    let id = "";
    setLayout(connectionId, (current) => {
      const widget = placeHomeWidget(current, kind, extra);
      id = widget.id;
      return [...current, widget];
    });
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-home-widget="${id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus className="size-3.5" />
          Widget hinzufügen
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Dashboard-Chart</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 w-64 overflow-y-auto">
            {dashboards.length === 0 && (
              <DropdownMenuItem disabled>
                Noch keine Charts für diese Datenbank vorhanden
              </DropdownMenuItem>
            )}
            {dashboards.map((dashboard) => (
              <div key={dashboard.id}>
                <DropdownMenuLabel>{dashboard.name}</DropdownMenuLabel>
                {dashboard.widgets.map((chart) => (
                  <DropdownMenuItem
                    key={chart.id}
                    onSelect={() =>
                      add("chart", {
                        dashboardId: dashboard.id,
                        chartId: chart.id,
                        w: Math.max(chart.w, HOME_WIDGETS.chart.minW),
                        h: Math.max(chart.h, HOME_WIDGETS.chart.minH),
                      })
                    }
                  >
                    <span className="truncate">
                      {chart.title ||
                        dashboard.datasets.find((dataset) => dataset.id === chart.datasetId)
                          ?.name ||
                        CHARTS[chart.chart].label}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {CHARTS[chart.chart].label}
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Abfrage-Ergebnis</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 w-64 overflow-y-auto">
            <DropdownMenuItem onSelect={() => add("query")}>Eigene Abfrage…</DropdownMenuItem>
            {saved.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Gespeicherte Abfragen</DropdownMenuLabel>
              </>
            )}
            {saved.map((query) => (
              <DropdownMenuItem
                key={query.id}
                onSelect={() => add("query", { title: query.name, sql: query.sql })}
              >
                <span className="truncate">{query.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => add("note")}>Notiz</DropdownMenuItem>
        {available.length > 0 && <DropdownMenuSeparator />}
        {available.map((kind) => (
          <DropdownMenuItem key={kind} onSelect={() => add(kind)}>
            {HOME_WIDGETS[kind].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

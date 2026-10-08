import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  CHARTS,
  type ChartTab,
  clearDashboardHistory,
  createId,
  type Dashboard,
  emptyDataset,
  type Period,
  paletteStyle,
  settle,
  useChartTabsStore,
  useDashboardPalette,
  useDashboardsStore,
  useVariableValuesStore,
} from "@/lib/dashboards";
import { useDbSelectionStore } from "@/lib/db-selection";
import { useHasNewFeatures } from "@/lib/new-features";
import { type ChartDraft, preferredChart } from "./chart-draft";
import { ChartLibraryDrawer } from "./chart-library-drawer";
import { DashboardCanvas } from "./dashboard-canvas";
import { useDashboardFileReload } from "./dashboard-editor/use-dashboard-file-reload";
import { DashboardLibraryDrawer } from "./dashboard-library-drawer";
import { DashboardPeriodContext } from "./dashboard-period";
import { DashboardScopeContext } from "./dashboard-scope";
import { DashboardTabStrip } from "./dashboard-tab-strip";
import { DashboardToolbar } from "./dashboard-toolbar";
import { DashboardVariablesBar } from "./dashboard-variables-bar";

const ChartStudio = lazy(() =>
  import("./chart-studio/chart-studio").then((module) => ({ default: module.ChartStudio })),
);

export function DashboardEditor({
  dashboard,
  siblings,
  connectionId,
  database,
}: {
  dashboard: Dashboard;
  siblings: Dashboard[];
  connectionId: string;
  database: string | null;
}) {
  const store = useDashboardsStore();
  const queryClient = useQueryClient();
  const hasNew = useHasNewFeatures("dashboard");
  const [drawer, setDrawer] = useState<"dashboards" | "charts" | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const paletteMode = useDashboardPalette((s) => s.mode);
  const allTabs = useChartTabsStore((s) => s.tabs);
  const chartTabs = useMemo(
    () => allTabs.filter((t) => t.dashboardId === dashboard.id),
    [allTabs, dashboard.id],
  );
  const activeTabId = useChartTabsStore((s) => s.active[dashboard.id] ?? null);
  const activeTab = chartTabs.find((t) => t.id === activeTabId) ?? null;

  const variableValues = useVariableValuesStore((s) => s.values[dashboard.id]);
  const variables = dashboard.variables ?? [];
  const scope = useMemo(
    () => ({ variables: dashboard.variables ?? [], values: variableValues ?? {} }),
    [dashboard.variables, variableValues],
  );
  const editing = !dashboard.locked;
  const canUndo = useStore(useDashboardsStore.temporal, (state) => state.pastStates.length > 0);
  const canRedo = useStore(useDashboardsStore.temporal, (state) => state.futureStates.length > 0);

  useEffect(() => clearDashboardHistory(), []);
  const update = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    store.update(dashboard.id, patch);

  const path = dashboard.filePath ?? null;

  const reloadFile = useDashboardFileReload(dashboard.id, path);

  const startNewChart = useCallback(() => {
    const index = dashboard.widgets.length;
    const dataset = emptyDataset(`Chart ${index + 1}`);
    const previous = dashboard.datasets.find((d) => d.mode === "simple" && d.simple.table);
    if (previous) {
      dataset.simple = {
        ...dataset.simple,
        schema: previous.simple.schema,
        table: previous.simple.table,
      };
    }
    const widget = settle(
      {
        id: createId(),
        chart: preferredChart(dataset),
        datasetId: dataset.id,
        title: "",
        period: "all",
        x: 0,
        y: 0,
        w: CHARTS.column.w,
        h: CHARTS.column.h,
      },
      dashboard.widgets,
    );
    useChartTabsStore.getState().open({ dashboardId: dashboard.id, widget, dataset, isNew: true });
  }, [dashboard.datasets, dashboard.widgets, dashboard.id]);

  const dashboardId = dashboard.id;
  const startEdit = useCallback(
    (widgetId: string) => {
      const current = useDashboardsStore.getState().dashboards.find((d) => d.id === dashboardId);
      const widget = current?.widgets.find((w) => w.id === widgetId);
      if (!current || !widget) return;
      const dataset =
        current.datasets.find((d) => d.id === widget.datasetId) ?? emptyDataset(widget.title);
      useChartTabsStore.getState().open({
        dashboardId,
        widget: structuredClone(widget),
        dataset: structuredClone(dataset),
        isNew: false,
      });
    },
    [dashboardId],
  );
  const openCharts = useCallback(() => setDrawer("charts"), []);

  const saveDraft = (tab: ChartTab, next: ChartDraft, close: boolean) => {
    const persisted = persistDraft(tab.isNew, next);
    if (close) useChartTabsStore.getState().close(tab.id);
    else useChartTabsStore.getState().saved(tab.id, persisted);
  };

  const persistDraft = (isNew: boolean, next: ChartDraft): ChartDraft => {
    if (isNew) {
      update((d) => ({
        widgets: [
          ...d.widgets,
          settle(
            { ...next.widget, w: CHARTS[next.widget.chart].w, h: CHARTS[next.widget.chart].h },
            d.widgets,
          ),
        ],
        datasets: [...d.datasets, next.dataset],
      }));
      return next;
    }
    let persisted = next;
    update((d) => {
      const shared = d.widgets.some(
        (w) => w.id !== next.widget.id && w.datasetId === next.widget.datasetId,
      );
      const exists = d.datasets.some((x) => x.id === next.dataset.id);
      const dataset = shared || !exists ? { ...next.dataset, id: createId() } : next.dataset;
      persisted = { widget: { ...next.widget, datasetId: dataset.id }, dataset };
      return {
        datasets:
          shared || !exists
            ? [...d.datasets, dataset]
            : d.datasets.map((x) => (x.id === dataset.id ? dataset : x)),
        widgets: d.widgets.map((w) => (w.id === next.widget.id ? persisted.widget : w)),
      };
    });
    return persisted;
  };

  const deleteDraft = (tab: ChartTab) => {
    const draft = tab;
    useChartTabsStore.getState().close(tab.id);
    update((d) => ({
      widgets: d.widgets.filter((w) => w.id !== draft.widget.id),
      datasets: d.datasets.filter(
        (dataset) =>
          dataset.id !== draft.widget.datasetId ||
          d.widgets.some((w) => w.id !== draft.widget.id && w.datasetId === dataset.id),
      ),
    }));
  };

  const duplicateDraft = (draft: ChartTab) => {
    update((d) => {
      const copy = settle(
        {
          ...structuredClone(draft.widget),
          id: createId(),
          title: `${draft.widget.title || draft.dataset.name || "Chart"} (Kopie)`,
        },
        d.widgets,
      );
      const dataset = { ...structuredClone(draft.dataset), id: createId() };
      copy.datasetId = dataset.id;
      return { widgets: [...d.widgets, copy], datasets: [...d.datasets, dataset] };
    });
  };

  return (
    <DashboardScopeContext.Provider value={scope}>
      <DashboardPeriodContext.Provider value={period}>
        <div
          className="flex min-h-0 flex-1 flex-col bg-background"
          style={paletteStyle(paletteMode)}
        >
          <DashboardToolbar
            dashboard={dashboard}
            siblings={siblings}
            database={database}
            editing={editing}
            compact={Boolean(activeTab)}
            canUndo={canUndo}
            canRedo={canRedo}
            hasNew={hasNew}
            period={period}
            onPeriod={setPeriod}
            onSelect={(id) => {
              const target = siblings.find((item) => item.id === id);
              if (target?.database)
                useDbSelectionStore.getState().setDatabase(connectionId, target.database);
              store.setActive(connectionId, id);
            }}
            onCreate={() => store.add(connectionId, database)}
            onUpdate={update}
            onNewChart={startNewChart}
            onReload={() => {
              void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
              void reloadFile(false);
            }}
            onDrawer={setDrawer}
          />
          {!activeTab && (editing || variables.length > 0) && (
            <div className="shrink-0 border-b px-3 py-2">
              <DashboardVariablesBar
                dashboardId={dashboard.id}
                variables={variables}
                editing={editing}
                onChange={(next) => update({ variables: next })}
              />
            </div>
          )}
          <DashboardTabStrip
            dashboardName={dashboard.name}
            tabs={chartTabs}
            active={activeTab?.id ?? null}
            onFocus={(id) => useChartTabsStore.getState().focus(dashboard.id, id)}
            onClose={(tab) => {
              if (tab.dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
              useChartTabsStore.getState().close(tab.id);
            }}
          />
          <DashboardLibraryDrawer
            open={drawer === "dashboards"}
            onOpenChange={(open) => setDrawer(open ? "dashboards" : null)}
            dashboard={dashboard}
            dashboards={siblings}
            connectionId={connectionId}
            database={database}
          />
          <ChartLibraryDrawer
            open={drawer === "charts"}
            onOpenChange={(open) => setDrawer(open ? "charts" : null)}
            dashboard={dashboard}
            onLoaded={(id) => {
              update({ locked: false });
              startEdit(id);
            }}
          />
          {activeTab ? (
            <Suspense fallback={null}>
              <ChartStudio
                key={activeTab.id}
                tab={activeTab}
                variablesBar={
                  <DashboardVariablesBar
                    dashboardId={dashboard.id}
                    variables={variables}
                    editing
                    onChange={(next) => update({ variables: next })}
                  />
                }
                onSave={(next, close) => saveDraft(activeTab, next, close)}
                onDelete={activeTab.isNew ? undefined : () => deleteDraft(activeTab)}
                onDuplicate={activeTab.isNew ? undefined : () => duplicateDraft(activeTab)}
                onClose={() => useChartTabsStore.getState().close(activeTab.id)}
              />
            </Suspense>
          ) : (
            <DashboardCanvas
              dashboardId={dashboard.id}
              onEdit={editing ? startEdit : undefined}
              onAdd={editing ? startNewChart : undefined}
              onOpenCharts={editing ? openCharts : undefined}
            />
          )}
        </div>
      </DashboardPeriodContext.Provider>
    </DashboardScopeContext.Provider>
  );
}

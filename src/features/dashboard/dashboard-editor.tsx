import { useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { type DashboardDesign, DEFAULT_DASHBOARD_DESIGN } from "@/lib/dashboard-design";
import {
  addPage,
  type BlockKind,
  blockWidget,
  CHARTS,
  type ChartTab,
  clearDashboardHistory,
  createId,
  type Dashboard,
  type DashboardTheme,
  dashboardPages,
  emptyDataset,
  type Period,
  pageOf,
  paletteStyle,
  removePage,
  sanitizeTheme,
  settle,
  staleFilter,
  themeCss,
  themeShowsHeader,
  useChartTabsStore,
  useCrossFilterStore,
  useDashboardPalette,
  useDashboardsStore,
  useVariableValuesStore,
  widgetsOnPage,
} from "@/lib/dashboards";
import { useDbSelectionStore } from "@/lib/db-selection";
import { useHasNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";
import { type ChartDraft, preferredChart } from "./chart-draft";
import { ChartLibraryDrawer } from "./chart-library-drawer";
import { DashboardBrandHeader } from "./dashboard-brand-header";
import { DashboardCanvas } from "./dashboard-canvas";
import { DashboardCrossFilterBar } from "./dashboard-cross-filter-bar";
import { DashboardDesignStyle } from "./dashboard-design-style";
import { useDashboardFileReload } from "./dashboard-editor/use-dashboard-file-reload";
import { DashboardInteractionContext } from "./dashboard-interaction";
import { DashboardLibraryDrawer } from "./dashboard-library-drawer";
import { DashboardPageNav } from "./dashboard-page-nav";
import { DashboardPeriodContext } from "./dashboard-period";
import { DashboardScopeContext } from "./dashboard-scope";
import { DashboardTabStrip } from "./dashboard-tab-strip";
import { DashboardToolbar } from "./dashboard-toolbar";
import { DashboardVariablesBar } from "./dashboard-variables-bar";
import { usePresentation } from "./use-presentation";
import { useSqlDialect } from "./use-sql-dialect";
import { WidgetDetailsDialog } from "./widget-details-dialog";

const ChartStudio = lazy(() =>
  import("./chart-studio/chart-studio").then((module) => ({ default: module.ChartStudio })),
);

const DashboardDesignPanel = lazy(() =>
  import("./dashboard-design-panel").then((module) => ({ default: module.DashboardDesignPanel })),
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
  const scopeId = useId();
  const [designDraft, setDesignDraft] = useState<DashboardDesign | null>(null);
  const [themeDraft, setThemeDraft] = useState<DashboardTheme | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const presentation = usePresentation();
  const pages = useMemo(() => dashboardPages(dashboard), [dashboard]);
  const activePage = pages.some((page) => page.id === pageId) ? (pageId as string) : pages[0].id;
  const theme = themeDraft ?? dashboard.theme ?? null;
  const [designError, setDesignError] = useState("");
  const [designSuspended, setDesignSuspended] = useState(false);
  const savedDesign = dashboard.design ?? DEFAULT_DASHBOARD_DESIGN;
  const selectedDesign = designDraft ?? savedDesign;
  const activeDesign = useMemo(() => {
    const own = selectedDesign.enabled && !designSuspended ? selectedDesign.css : "";
    return { css: `${themeCss(theme)}${own}`, enabled: true };
  }, [selectedDesign, designSuspended, theme]);
  const interaction = useMemo(
    () => ({
      dashboardId: dashboard.id,
      presenting: presentation.presenting,
      goToPage: (id: string) => setPageId(id),
    }),
    [dashboard.id, presentation.presenting],
  );
  useEffect(() => () => useCrossFilterStore.getState().clear(dashboard.id), [dashboard.id]);
  const dialect = useSqlDialect();
  useEffect(() => {
    useCrossFilterStore
      .getState()
      .retain(dashboard.id, (filter) => !staleFilter(filter, dashboard, dialect));
  }, [dashboard, dialect]);
  useEffect(() => {
    const recover = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.code !== "KeyD") return;
      event.preventDefault();
      setDesignSuspended(true);
      setDesignDraft((draft) => draft ?? { ...(dashboard.design ?? DEFAULT_DASHBOARD_DESIGN) });
    };
    window.addEventListener("keydown", recover);
    return () => window.removeEventListener("keydown", recover);
  }, [dashboard.design]);
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
  const editing = !dashboard.locked && !presentation.presenting;
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
        page: dashboard.pages?.length ? activePage : undefined,
        x: 0,
        y: 0,
        w: CHARTS.column.w,
        h: CHARTS.column.h,
      },
      widgetsOnPage(dashboard.widgets, pages, activePage),
    );
    useChartTabsStore.getState().open({ dashboardId: dashboard.id, widget, dataset, isNew: true });
  }, [dashboard.datasets, dashboard.widgets, dashboard.id, dashboard.pages, pages, activePage]);

  const addBlock = (type: BlockKind) =>
    update((d) => {
      const list = dashboardPages(d);
      const widget = blockWidget(type, activePage, d.widgets, list);
      return { widgets: [...d.widgets, d.pages?.length ? widget : { ...widget, page: undefined }] };
    });

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
            widgetsOnPage(d.widgets, dashboardPages(d), pageOf(next.widget, dashboardPages(d))),
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
        widgetsOnPage(d.widgets, dashboardPages(d), pageOf(draft.widget, dashboardPages(d))),
      );
      const dataset = { ...structuredClone(draft.dataset), id: createId() };
      copy.datasetId = dataset.id;
      return { widgets: [...d.widgets, copy], datasets: [...d.datasets, dataset] };
    });
  };

  const showHeader = themeShowsHeader(theme);
  const sidebarNav = theme?.nav === "sidebar";
  const pageNav = (
    <DashboardPageNav
      pages={pages}
      active={activePage}
      editing={editing}
      vertical={sidebarNav}
      onSelect={setPageId}
      onChange={(next) => update({ pages: next })}
      onAdd={() => {
        const current = useDashboardsStore.getState().dashboards.find((d) => d.id === dashboard.id);
        if (!current) return;
        const base = dashboardPages(current);
        const next = addPage(current, "");
        const added = next[next.length - 1];
        const first = base[0].id;
        update((d) => ({
          pages: next,
          widgets: d.pages?.length
            ? d.widgets
            : d.widgets.map((w) => (w.page ? w : { ...w, page: first })),
        }));
        setPageId(added.id);
      }}
      onRemove={(id) => {
        update((d) => removePage(d, id));
        if (id === activePage) setPageId(null);
      }}
    />
  );

  return (
    <DashboardScopeContext.Provider value={scope}>
      <DashboardInteractionContext.Provider value={interaction}>
        <DashboardPeriodContext.Provider value={period}>
          <DashboardDesignStyle scopeId={scopeId} design={activeDesign} onError={setDesignError} />
          <WidgetDetailsDialog />
          <div
            className={cn(
              "flex min-h-0 flex-1 overflow-hidden",
              presentation.presenting && "fixed inset-0 z-50 bg-background",
            )}
          >
            <div
              id={`dashboard-design-${scopeId}`}
              data-dashboard-design={scopeId}
              data-presenting={presentation.presenting || undefined}
              className="dashboard-surface relative flex min-h-0 min-w-0 flex-1 flex-col bg-background"
              style={paletteStyle(paletteMode)}
            >
              {presentation.presenting ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-3 right-3 z-20 h-7 opacity-60 hover:opacity-100"
                  onClick={presentation.stop}
                >
                  <XIcon /> Präsentation beenden
                </Button>
              ) : (
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
                  onAddBlock={addBlock}
                  onPresent={() => {
                    useChartTabsStore.getState().focus(dashboard.id, null);
                    setDesignDraft(null);
                    setThemeDraft(null);
                    presentation.start();
                  }}
                  onReload={() => {
                    void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
                    void reloadFile(false);
                  }}
                  onDesign={() => {
                    setDesignSuspended(false);
                    setDesignDraft({ ...savedDesign });
                    setThemeDraft({ ...(dashboard.theme ?? {}) });
                  }}
                  onDrawer={setDrawer}
                />
              )}
              {!activeTab && showHeader && theme && (
                <DashboardBrandHeader theme={theme} fallbackName={dashboard.name} />
              )}
              {!activeTab && !sidebarNav && pageNav}
              {!activeTab && (editing || variables.length > 0) && (
                <div className="dashboard-filters shrink-0 border-b px-3 py-2">
                  <DashboardVariablesBar
                    dashboardId={dashboard.id}
                    variables={variables}
                    editing={editing}
                    onChange={(next) => update({ variables: next })}
                  />
                </div>
              )}
              {!activeTab && <DashboardCrossFilterBar dashboardId={dashboard.id} />}
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
                pageId={activePage}
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
                <div className="flex min-h-0 flex-1">
                  {sidebarNav && pageNav}
                  <DashboardCanvas
                    key={activePage}
                    dashboardId={dashboard.id}
                    pageId={activePage}
                    onEdit={editing ? startEdit : undefined}
                    onAdd={editing ? startNewChart : undefined}
                    onOpenCharts={editing ? openCharts : undefined}
                  />
                </div>
              )}
            </div>
            {designDraft && !presentation.presenting && (
              <Suspense fallback={null}>
                <DashboardDesignPanel
                  dashboardId={dashboard.id}
                  design={designDraft}
                  theme={themeDraft ?? {}}
                  error={designError}
                  onChange={(next) => {
                    setDesignSuspended(false);
                    setDesignDraft(next);
                  }}
                  onThemeChange={setThemeDraft}
                  onClose={() => {
                    setDesignDraft(null);
                    setThemeDraft(null);
                  }}
                  onSave={() => {
                    update({ design: designDraft, theme: sanitizeTheme(themeDraft) });
                    setDesignSuspended(false);
                    setDesignDraft(null);
                    setThemeDraft(null);
                  }}
                />
              </Suspense>
            )}
          </div>
        </DashboardPeriodContext.Provider>
      </DashboardInteractionContext.Provider>
    </DashboardScopeContext.Provider>
  );
}

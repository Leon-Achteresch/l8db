import {
  AutoScroller,
  type DragEndEvent,
  defaultPreset,
  Feedback,
  PointerActivationConstraints,
} from "@dnd-kit/dom";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DeferredOutlet } from "@/features/shell/deferred-outlet";
import { EnvironmentBanner } from "@/features/shell/environment-banner";
import { MasterSelectionScope } from "@/features/shell/master-selection-scope";
import { SplitWorkspace } from "@/features/shell/split-workspace";
import { NewPaneDropZone } from "@/features/shell/split-workspace/new-pane-drop-zone";
import { TableTabs } from "@/features/shell/table-tabs";
import { WorkspacePendingView } from "@/features/shell/workspace-pending-view";
import { useActiveConnection } from "@/lib/connections";
import { isEasyModeTabVisible } from "@/lib/easy-mode";
import { useConnectionEnvironment } from "@/lib/environments";
import { useFkDrawerStack } from "@/lib/fk-drawer-stack";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { usePaneSourceKey } from "@/lib/master-detail";
import { useSettingsStore } from "@/lib/settings";
import {
  isBoundToSplit,
  placeOpenTab,
  standaloneTabs,
  useSplitShown,
  useSplitView,
} from "@/lib/split-view";
import {
  type DropSource,
  type DropTarget,
  resolveDrop,
  showDropPreview,
  tabDragData,
} from "@/lib/tab-drop";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import { tabKey, useTableTabs } from "@/lib/table-tabs";
import { toolIdForPath } from "@/lib/tool-tabs";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

const FkDrawerStack = lazy(() =>
  import("@/features/table/fk-drawer-stack").then((module) => ({ default: module.FkDrawerStack })),
);
const SqlIntellisenseSync = lazy(() => import("@/features/shell/sql-intellisense-sync"));

function subscribeMonacoReady(notify: () => void) {
  window.addEventListener("l8db:monaco-ready", notify);
  return () => window.removeEventListener("l8db:monaco-ready", notify);
}

function isMonacoReady() {
  return "MonacoEnvironment" in self;
}

type Operation = DragEndEvent["operation"];

function dropSource(operation: Operation): DropSource | null {
  const { source } = operation;
  if (!source) return null;
  if (source.type === "pane") return { type: "pane", index: Number(source.data?.index) };
  const tab = tabDragData(source.data);
  return tab ? { type: "tab", key: tab.key } : null;
}

function dropTarget(operation: Operation, point: { x: number; y: number }): DropTarget | null {
  const { source } = operation;
  for (const element of document.querySelectorAll<HTMLElement>("[data-drop-zone]")) {
    const rect = element.getBoundingClientRect();
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom)
      continue;
    const id = element.dataset.dropZone ?? "";
    if (id === "master" || id.startsWith("strip:")) {
      const pane = id === "master" ? "master" : Number(id.slice(6));
      const tab = source?.type === "tab" ? tabDragData(source.data) : null;
      if (!tab || tab.group === (pane === "master" ? "main" : `pane-${pane}`)) return null;
      if (pane === "master" && isBoundToSplit(useSplitView.getState(), tab.key)) return null;
      return {
        type: "strip",
        pane,
        left: rect.left,
        tabs: [...element.querySelectorAll<HTMLElement>("[data-tab-key]")].map((tab) => {
          const box = tab.getBoundingClientRect();
          return { left: box.left, right: box.right };
        }),
      };
    }
    const pane = id.slice(5);
    return { type: "pane", pane: pane === "single" ? "single" : Number(pane), rect };
  }
  return null;
}

const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: () => false,
  }),
];

const plugins = defaultPreset.plugins
  .filter((plugin) => plugin !== AutoScroller)
  .map((plugin) => (plugin === Feedback ? Feedback.configure({ dropAnimation: null }) : plugin));

export function WorkspaceLayout() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const environment = useConnectionEnvironment(useActiveConnection());
  const productionColor = environment?.value === "production" ? environment.color : null;
  const tool = useRouterSelect((state) => toolIdForPath(state.location.pathname));
  const openToolTab = useTableTabs((state) => state.openToolTab);

  useEffect(() => {
    if (tool && tool !== "compare" && tool !== "schema-compare" && tool !== "workbench")
      openToolTab(tool);
  }, [tool, openToolTab]);

  const activeTab = useActiveWorkspaceTab();
  const pendingTab = useActiveWorkspaceTab(true);
  const switchingTab = pendingTab && (!activeTab || tabKey(pendingTab) !== tabKey(activeTab));
  const navigate = useNavigate();
  const split = useSplitView((state) => state.panes.length > 1);
  const routeKey = activeTab ? tabKey(activeTab) : "";
  const shown = useSplitShown(routeKey || null);
  const hasFkDrawer = useFkDrawerStack((state) => state.stack.length > 0);
  const fkDrawerUsed = useRef(false);
  if (hasFkDrawer) fkDrawerUsed.current = true;
  const monacoReady = useSyncExternalStore(subscribeMonacoReady, isMonacoReady);
  const reveal = useSplitView((state) => state.reveal);
  const selectionKey = usePaneSourceKey(routeKey || null);
  const previousKey = useRef("");
  const dropped = useRef(false);

  useEffect(() => {
    if (!easyMode && routeKey && previousKey.current !== routeKey) reveal(routeKey);
    previousKey.current = routeKey;
  }, [routeKey, reveal, easyMode]);

  const resolve = (operation: Operation, to?: { x: number; y: number }) => {
    const source = dropSource(operation);
    const point = to ?? operation.position.current;
    if (easyMode || !source || !point) return null;
    const state = useSplitView.getState();
    return resolveDrop(source, dropTarget(operation, point), point, {
      paneTabs: state.panes.length > 1 ? state.paneTabs : [],
      single: useTableTabs.getState().tabs.map(tabKey),
      active: routeKey || null,
    });
  };
  const preview = (operation: Operation, to?: { x: number; y: number }) =>
    showDropPreview(resolve(operation, to)?.preview ?? null);
  const masterKeys = () =>
    standaloneTabs(
      useTableTabs.getState().tabs.filter((tab) => isEasyModeTabVisible(tab, easyMode)),
      easyMode ? [] : useSplitView.getState().paneTabs,
    ).map(tabKey);
  const followFocus = (fallback: string | null, standalone = false) => {
    const state = useSplitView.getState();
    if (standalone && fallback) state.reveal(fallback);
    const key = !standalone && state.panes.length > 1 ? state.panes[state.focusedPane] : fallback;
    const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
    if (tab && key !== routeKey) navigateToTab(navigate, tab);
  };

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={plugins}
      onDragStart={() => {
        dropped.current = false;
      }}
      onDragOver={(event) => {
        if (dropped.current) event.preventDefault();
        else preview(event.operation);
      }}
      onDragMove={({ operation, to }) => preview(operation, to)}
      onDragEnd={({ operation, canceled, nativeEvent }, manager) => {
        dropped.current = true;
        const point =
          nativeEvent instanceof MouseEvent
            ? { x: nativeEvent.clientX, y: nativeEvent.clientY }
            : undefined;
        const result = canceled ? null : resolve(operation, point);
        showDropPreview(null);
        const { source } = operation;
        if (canceled || !source) return;
        void manager.renderer.rendering.then(() => {
          const key = tabDragData(source.data)?.key ?? null;
          const sorted = isSortable(source) && source.initialIndex !== source.index;
          const group = isSortable(source) ? String(source.group ?? "") : "";
          if (key && sorted) {
            if (group === "main")
              placeOpenTab(
                key,
                masterKeys().filter((entry) => entry !== key)[source.index] ?? null,
              );
            else if (group.startsWith("pane-"))
              useSplitView.getState().moveTab(key, Number(group.slice(5)), source.index);
          }
          const action = easyMode ? null : result?.action;
          const store = useSplitView.getState();
          if (action?.type === "swap") store.swapPanes(action.from, action.to);
          else if (action?.type === "move") store.moveTab(action.key, action.pane, action.at);
          else if (action?.type === "detach")
            store.detach(action.key, masterKeys()[action.at] ?? null);
          else if (action?.type === "split")
            store.split({
              activeKey: routeKey || null,
              key: action.key,
              target: action.pane === "single" ? undefined : action.pane,
              edge: action.edge,
            });
          if (action || (key && sorted))
            followFocus(key, action?.type === "detach" || (!action && group === "main"));
        });
      }}
    >
      {monacoReady && (
        <Suspense fallback={null}>
          <SqlIntellisenseSync />
        </Suspense>
      )}
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={productionColor ? { boxShadow: `inset 0 0 0 2px ${productionColor}` } : undefined}
      >
        <EnvironmentBanner />
        <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 bg-primary/[0.035] px-1.5">
          <SidebarTrigger className="size-7 rounded-full" />
          <TableTabs />
        </header>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            inert={Boolean(switchingTab)}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            {!easyMode && shown ? (
              <SplitWorkspace />
            ) : (
              <>
                <DeferredOutlet>
                  {(outlet) => (
                    <MasterSelectionScope selectionKey={selectionKey}>
                      {outlet}
                    </MasterSelectionScope>
                  )}
                </DeferredOutlet>
                {!easyMode && activeTab && !split && <NewPaneDropZone />}
              </>
            )}
          </div>
          {switchingTab && <WorkspacePendingView label={tabLabel(pendingTab)} />}
          {fkDrawerUsed.current && (
            <Suspense fallback={null}>
              <FkDrawerStack />
            </Suspense>
          )}
        </div>
      </div>
    </DragDropProvider>
  );
}

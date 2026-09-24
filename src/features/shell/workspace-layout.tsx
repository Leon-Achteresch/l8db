import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DeferredOutlet } from "@/features/shell/deferred-outlet";
import { NewPaneDropZone, SplitWorkspace } from "@/features/shell/split-workspace";
import { TableTabs } from "@/features/shell/table-tabs";
import { WorkspacePendingView } from "@/features/shell/workspace-pending-view";
import { useFkDrawerStack } from "@/lib/fk-drawer-stack";
import { MasterSelectionContext, usePaneSourceKey } from "@/lib/master-detail";
import { useSettingsStore } from "@/lib/settings";
import { useSplitView } from "@/lib/split-view";
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

const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: () => false,
  }),
];

export function WorkspaceLayout() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const openToolTab = useTableTabs((state) => state.openToolTab);

  useEffect(() => {
    const tool = toolIdForPath(pathname);
    if (tool && tool !== "compare") openToolTab(tool);
  }, [pathname, openToolTab]);

  const activeTab = useActiveWorkspaceTab();
  const pendingTab = useActiveWorkspaceTab(true);
  const switchingTab = pendingTab && (!activeTab || tabKey(pendingTab) !== tabKey(activeTab));
  const navigate = useNavigate();
  const split = useSplitView((state) => state.panes.length > 1);
  const hasFkDrawer = useFkDrawerStack((state) => state.stack.length > 0);
  const fkDrawerUsed = useRef(false);
  if (hasFkDrawer) fkDrawerUsed.current = true;
  const monacoReady = useSyncExternalStore(subscribeMonacoReady, isMonacoReady);
  const reveal = useSplitView((state) => state.reveal);
  const routeKey = activeTab ? tabKey(activeTab) : "";
  const selectionKey = usePaneSourceKey(routeKey || null);
  const previousKey = useRef(routeKey);

  useEffect(() => {
    if (!easyMode && routeKey && previousKey.current !== routeKey) reveal(routeKey);
    previousKey.current = routeKey;
  }, [routeKey, reveal, easyMode]);

  return (
    <DragDropProvider
      sensors={sensors}
      onDragEnd={({ operation, canceled }) => {
        if (canceled) return;
        const { source, target } = operation;
        if (!source) return;
        const targetId = typeof target?.id === "string" ? target.id : "";
        const paneIndex = targetId.startsWith("pane:") ? targetId.slice(5) : null;
        const { setPane, swapPanes, addPane, panes } = useSplitView.getState();
        if (!easyMode && paneIndex !== null && source.type === "tab") {
          const key = String(source.id);
          if (paneIndex === "new") {
            addPane(panes.length === 0 && activeTab ? tabKey(activeTab) : null, key);
          } else {
            setPane(Number(paneIndex), key);
          }
          const tab = useTableTabs.getState().tabs.find((t) => tabKey(t) === key);
          if (tab) navigateToTab(navigate, tab);
          return;
        }
        if (!easyMode && paneIndex !== null && source.type === "pane") {
          const from = Number((source.data as { index: number }).index);
          swapPanes(from, Number(paneIndex));
          return;
        }
        if (isSortable(source) && source.type === "tab" && source.initialIndex !== source.index) {
          useTableTabs.getState().reorderTabs(source.initialIndex, source.index);
        }
      }}
    >
      {monacoReady && (
        <Suspense fallback={null}>
          <SqlIntellisenseSync />
        </Suspense>
      )}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 bg-primary/[0.035] px-1.5">
          <SidebarTrigger className="size-7 rounded-full" />
          <TableTabs />
        </header>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            inert={Boolean(switchingTab)}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            {!easyMode && split && activeTab ? (
              <SplitWorkspace />
            ) : (
              <>
                <MasterSelectionContext.Provider key={selectionKey} value={selectionKey}>
                  <DeferredOutlet />
                </MasterSelectionContext.Provider>
                {!easyMode && activeTab && <NewPaneDropZone />}
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

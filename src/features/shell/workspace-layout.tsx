import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NewPaneDropZone, SplitWorkspace } from "@/features/shell/split-workspace";
import { TableTabs } from "@/features/shell/table-tabs";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useSplitView } from "@/lib/split-view";
import { navigateToTab } from "@/lib/tab-navigation";
import { tabKey, useTableTabs } from "@/lib/table-tabs";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: () => false,
  }),
];

export function WorkspaceLayout() {
  const activeTab = useActiveWorkspaceTab();
  const navigate = useNavigate();
  const split = useSplitView((state) => state.panes.length > 1);
  const reveal = useSplitView((state) => state.reveal);
  const routeKey = activeTab ? tabKey(activeTab) : "";
  const previousKey = useRef(routeKey);

  useEffect(() => {
    if (routeKey && previousKey.current !== routeKey) reveal(routeKey);
    previousKey.current = routeKey;
  }, [routeKey, reveal]);

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
        if (paneIndex !== null && source.type === "tab") {
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
        if (paneIndex !== null && source.type === "pane") {
          const from = Number((source.data as { index: number }).index);
          swapPanes(from, Number(paneIndex));
          return;
        }
        if (isSortable(source) && source.type === "tab" && source.initialIndex !== source.index) {
          useTableTabs.getState().reorderTabs(source.initialIndex, source.index);
        }
      }}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/70 px-3 py-1 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
          <TableTabs />
        </header>
        <motion.div
          layout
          transition={{ layout: SPRING_LAYOUT }}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {split && activeTab ? (
            <SplitWorkspace />
          ) : (
            <>
              <Outlet />
              {activeTab && <NewPaneDropZone />}
            </>
          )}
        </motion.div>
      </div>
    </DragDropProvider>
  );
}

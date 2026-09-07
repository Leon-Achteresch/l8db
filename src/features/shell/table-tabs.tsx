import { useNavigate } from "@tanstack/react-router";
import { Columns2Icon, FolderOpenIcon, PlusIcon, SquareIcon } from "lucide-react";
import type * as React from "react";
import { useRef } from "react";

import { TableTabsSortableTab } from "@/features/shell/table-tabs-sortable-tab";
import { openSqlFileAsTab } from "@/lib/hooks/use-query-file";
import { MAX_SPLIT_PANES, useSplitView } from "@/lib/split-view";
import { navigateToTab } from "@/lib/tab-navigation";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { useActiveWorkspaceTab, useTabRouteMatch } from "@/lib/use-active-workspace-tab";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border/60 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function TableTabs() {
  const tabs = useTableTabs((state) => state.tabs);
  const closeTab = useTableTabs((state) => state.closeTab);
  const closeOtherTabs = useTableTabs((state) => state.closeOtherTabs);
  const closeTabsToRight = useTableTabs((state) => state.closeTabsToRight);
  const closeAllTabs = useTableTabs((state) => state.closeAllTabs);
  const openQueryTab = useTableTabs((state) => state.openQueryTab);
  const panes = useSplitView((state) => state.panes);
  const focusedPane = useSplitView((state) => state.focusedPane);
  const addPane = useSplitView((state) => state.addPane);
  const collapse = useSplitView((state) => state.collapse);
  const reveal = useSplitView((state) => state.reveal);
  const matchTab = useTabRouteMatch();
  const activeWorkspaceTab = useActiveWorkspaceTab();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const split = panes.length > 1;

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const el = navRef.current;
    if (!el || event.deltaY === 0 || event.shiftKey) return;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += event.deltaY;
  };

  const isTabActive = (tab: Tab) => (split ? panes[focusedPane] === tabKey(tab) : matchTab(tab));

  const activeTab = tabs.find(isTabActive) ?? activeWorkspaceTab;

  const handleClose = (tab: Tab) => {
    const key = tabKey(tab);
    const wasActive = isTabActive(tab);
    const index = tabs.findIndex((t) => tabKey(t) === key);
    closeTab(key);
    if (!wasActive) return;
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (next) {
      navigateToTab(navigate, next);
    } else {
      void navigate({ to: "/" });
    }
  };

  const handleCloseOthers = (tab: Tab) => {
    closeOtherTabs(tabKey(tab));
    navigateToTab(navigate, tab);
  };

  const handleCloseToRight = (tab: Tab) => {
    const index = tabs.findIndex((t) => tabKey(t) === tabKey(tab));
    const remaining = tabs.slice(0, index + 1);
    closeTabsToRight(tabKey(tab));
    if (activeTab && !remaining.some((t) => tabKey(t) === tabKey(activeTab))) {
      navigateToTab(navigate, tab);
    }
  };

  const handleCloseAll = () => {
    closeAllTabs();
    collapse();
    void navigate({ to: "/" });
  };

  const handleSplit = () => {
    const key = activeTab ? tabKey(activeTab) : tabs[0] ? tabKey(tabs[0]) : null;
    addPane(key);
    if (!activeTab && tabs[0]) navigateToTab(navigate, tabs[0]);
  };

  const handleSplitTab = (tab: Tab) => {
    addPane(activeTab ? tabKey(activeTab) : null, tabKey(tab));
    navigateToTab(navigate, tab);
  };

  const handleAuxClick = (event: React.MouseEvent, tab: Tab) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    handleClose(tab);
  };

  const handleNewQueryTab = () => {
    const id = openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  };

  const handleOpenSqlFile = async () => {
    const id = await openSqlFileAsTab();
    if (id) void navigate({ to: "/query/$id", params: { id } });
  };

  const handleCopy = (value: string) => {
    void navigator.clipboard.writeText(value);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <nav
        ref={navRef}
        onWheel={handleWheel}
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2"
      >
        {tabs.map((tab, index) => (
          <TableTabsSortableTab
            key={tabKey(tab)}
            tab={tab}
            index={index}
            isActive={isTabActive(tab)}
            isInPane={split && panes.includes(tabKey(tab))}
            hasTabsToRight={index < tabs.length - 1}
            tabsCount={tabs.length}
            canSplit={panes.length < MAX_SPLIT_PANES}
            onNavigate={() => {
              if (split) reveal(tabKey(tab));
              navigateToTab(navigate, tab);
            }}
            onClose={() => handleClose(tab)}
            onCloseOthers={() => handleCloseOthers(tab)}
            onCloseToRight={() => handleCloseToRight(tab)}
            onCloseAll={handleCloseAll}
            onSplit={() => handleSplitTab(tab)}
            onAuxClick={(event) => handleAuxClick(event, tab)}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onCopyTable={tab.kind === "table" ? () => handleCopy(tab.table) : undefined}
            onCopyFull={
              tab.kind === "table" ? () => handleCopy(`${tab.schema}.${tab.table}`) : undefined
            }
          />
        ))}
      </nav>

      <button
        type="button"
        onClick={handleSplit}
        disabled={tabs.length === 0 || panes.length >= MAX_SPLIT_PANES}
        title="Ansicht teilen"
        className={iconButton}
      >
        <Columns2Icon className="size-4" />
      </button>
      {split && (
        <button type="button" onClick={collapse} title="Einzelansicht" className={iconButton}>
          <SquareIcon className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={handleNewQueryTab}
        title="Neue Abfrage öffnen"
        className={iconButton}
      >
        <PlusIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => void handleOpenSqlFile()}
        title="SQL-Datei öffnen"
        className={iconButton}
      >
        <FolderOpenIcon className="size-4" />
      </button>
    </div>
  );
}

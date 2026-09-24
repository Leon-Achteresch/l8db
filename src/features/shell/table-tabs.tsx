import { useNavigate, useRouter } from "@tanstack/react-router";
import { Columns2, Rows2 } from "lucide";
import { FolderOpenIcon, PlusIcon, SquareIcon, SquareSplitHorizontalIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import type * as React from "react";
import { useCallback, useEffect } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { CloseConfirmDialog } from "@/features/shell/table-tabs/close-confirm-dialog";
import { iconButton } from "@/features/shell/table-tabs/constants";
import { HiddenTabsMenu } from "@/features/shell/table-tabs/hidden-tabs-menu";
import { useTabClose } from "@/features/shell/table-tabs/use-tab-close";
import { TableTabsSortableTab } from "@/features/shell/table-tabs-sortable-tab";
import { copyText } from "@/lib/clipboard";
import { isEasyModeTabVisible } from "@/lib/easy-mode";
import { openSqlFileAsTab } from "@/lib/hooks/use-query-file";
import { useTabOverflow } from "@/lib/hooks/use-tab-overflow";
import { onHotkeyAction } from "@/lib/hotkeys";
import { useSettingsStore } from "@/lib/settings";
import { MAX_SPLIT_PANES, useSplitView } from "@/lib/split-view";
import { navigateToTab, preloadTab } from "@/lib/tab-navigation";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { useActiveWorkspaceTab, useTabRouteMatch } from "@/lib/use-active-workspace-tab";

export function TableTabs() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const allTabs = useTableTabs((state) => state.tabs);
  const tabs = allTabs.filter((tab) => isEasyModeTabVisible(tab, easyMode));
  const openQueryTab = useTableTabs((state) => state.openQueryTab);
  const orientation = useSplitView((state) => state.orientation);
  const setOrientation = useSplitView((state) => state.setOrientation);
  const panes = useSplitView((state) => state.panes);
  const focusedPane = useSplitView((state) => state.focusedPane);
  const addPane = useSplitView((state) => state.addPane);
  const collapse = useSplitView((state) => state.collapse);
  const reveal = useSplitView((state) => state.reveal);
  const matchTab = useTabRouteMatch();
  const activeWorkspaceTab = useActiveWorkspaceTab();
  const pendingTab = useActiveWorkspaceTab(true);
  const router = useRouter();
  const navigate = useNavigate();
  const split = !easyMode && panes.length > 1;
  const orientationLabel =
    orientation === "horizontal" ? "Bereiche untereinander" : "Bereiche nebeneinander";

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const el = navRef.current;
    if (!el || event.deltaY === 0 || event.shiftKey) return;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += event.deltaY;
  };

  const isTabActive = (tab: Tab) => (split ? panes[focusedPane] === tabKey(tab) : matchTab(tab));

  const activeTab = tabs.find(isTabActive) ?? activeWorkspaceTab;
  const { containerRef, navRef, trackRef, overflow, hiddenKeys, revealTab } = useTabOverflow(
    pendingTab ? tabKey(pendingTab) : activeTab ? tabKey(activeTab) : undefined,
    tabs,
  );
  const hiddenTabs = tabs.filter((tab) => hiddenKeys.includes(tabKey(tab)));

  const {
    pendingClose,
    setPendingClose,
    savingClose,
    saveAndClose,
    executeClose,
    handleClose,
    handleCloseOthers,
    handleCloseToRight,
    handleCloseAll,
  } = useTabClose({ tabs, activeTab, isTabActive, navigate });

  const handleSplit = useCallback(() => {
    if (easyMode) return;
    const key = activeTab ? tabKey(activeTab) : tabs[0] ? tabKey(tabs[0]) : null;
    addPane(key);
    if (!activeTab && tabs[0]) navigateToTab(navigate, tabs[0]);
  }, [activeTab, addPane, navigate, tabs, easyMode]);

  useEffect(() => onHotkeyAction("view.split", handleSplit), [handleSplit]);

  const handleSplitTab = (tab: Tab) => {
    if (easyMode) return;
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
    void copyText(value);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div ref={containerRef} className="flex min-w-0 items-center">
        <motion.nav
          layoutScroll
          ref={navRef}
          onWheel={handleWheel}
          aria-label="Geöffnete Objekte"
          className="no-scrollbar min-w-0 overflow-x-auto py-1"
        >
          <div ref={trackRef} className="relative flex w-max items-center gap-1 px-1">
            {tabs.map((tab, index) => (
              <TableTabsSortableTab
                key={tabKey(tab)}
                tab={tab}
                index={allTabs.indexOf(tab)}
                isActive={pendingTab ? tabKey(pendingTab) === tabKey(tab) : isTabActive(tab)}
                isPending={Boolean(pendingTab && tabKey(pendingTab) === tabKey(tab))}
                onPreload={() => preloadTab(router, tab)}
                isInPane={split && panes.includes(tabKey(tab))}
                hasTabsToRight={index < tabs.length - 1}
                tabsCount={tabs.length}
                canSplit={!easyMode && panes.length < MAX_SPLIT_PANES}
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
          </div>
        </motion.nav>
        {overflow && (
          <HiddenTabsMenu
            hiddenTabs={hiddenTabs}
            split={split}
            revealTab={revealTab}
            navigate={navigate}
          />
        )}
      </div>
      <Tooltip content="Neue Abfrage öffnen" side="bottom" wrapperClassName="shrink-0">
        <button
          type="button"
          onClick={handleNewQueryTab}
          aria-label="Neue Abfrage öffnen"
          className={`${iconButton} bg-primary/8 text-primary hover:bg-primary/15`}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </Tooltip>
      <div className="min-w-0 flex-1" />

      {!easyMode && (
        <Tooltip content="Ansicht teilen" side="bottom" wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={handleSplit}
            disabled={tabs.length === 0 || panes.length >= MAX_SPLIT_PANES}
            aria-label="Ansicht teilen"
            className={iconButton}
          >
            <SquareSplitHorizontalIcon className="size-3.5" />
          </button>
        </Tooltip>
      )}
      {!easyMode && panes.length === 2 && (
        <Tooltip content={orientationLabel} side="bottom" wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={() => setOrientation(orientation === "horizontal" ? "vertical" : "horizontal")}
            aria-label={orientationLabel}
            className={iconButton}
          >
            <MorphIcon
              icon={orientation === "horizontal" ? Rows2 : Columns2}
              className="size-3.5"
            />
          </button>
        </Tooltip>
      )}
      {split && (
        <Tooltip content="Einzelansicht" side="bottom" wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={collapse}
            aria-label="Einzelansicht"
            className={iconButton}
          >
            <SquareIcon className="size-3.5" />
          </button>
        </Tooltip>
      )}
      <Tooltip content="SQL-Datei öffnen" side="bottom" wrapperClassName="shrink-0">
        <button
          type="button"
          onClick={() => void handleOpenSqlFile()}
          aria-label="SQL-Datei öffnen"
          className={iconButton}
        >
          <FolderOpenIcon className="size-3.5" />
        </button>
      </Tooltip>
      <CloseConfirmDialog
        pendingClose={pendingClose}
        setPendingClose={setPendingClose}
        savingClose={savingClose}
        saveAndClose={saveAndClose}
        executeClose={executeClose}
      />
    </div>
  );
}

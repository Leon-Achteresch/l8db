import { useNavigate, useRouter } from "@tanstack/react-router";
import { Columns2, RotateCwSquare, Rows2 } from "lucide";
import { FolderOpenIcon, PlusIcon, SquareIcon, SquareSplitHorizontalIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import type * as React from "react";
import { Fragment, useCallback, useEffect, useRef } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import { CloseConfirmDialog } from "@/features/shell/table-tabs/close-confirm-dialog";
import { iconButton } from "@/features/shell/table-tabs/constants";
import { HiddenTabsMenu } from "@/features/shell/table-tabs/hidden-tabs-menu";
import { SplitGroupTab } from "@/features/shell/table-tabs/split-group-tab";
import { SplitGroupsMenu } from "@/features/shell/table-tabs/split-groups-menu";
import { TabGroupLabel } from "@/features/shell/table-tabs/tab-group-label";
import { useTabClose } from "@/features/shell/table-tabs/use-tab-close";
import { useTabGroups } from "@/features/shell/table-tabs/use-tab-groups";
import {
  type TableTabActions,
  TableTabsSortableTab,
} from "@/features/shell/table-tabs-sortable-tab";
import { isEasyModeTabVisible } from "@/lib/easy-mode";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { openSqlFileAsTab } from "@/lib/hooks/use-query-file";
import { useTabOverflow } from "@/lib/hooks/use-tab-overflow";
import { onHotkeyAction } from "@/lib/hotkeys";
import { useHasNewFeatures } from "@/lib/new-features";
import { useSettingsStore } from "@/lib/settings";
import type { SplitEdge } from "@/lib/split-layout";
import { MAX_SPLIT_PANES, type SplitGroup, useSplitGroups, useSplitView } from "@/lib/split-view";
import { navigateToTab, preloadTab } from "@/lib/tab-navigation";
import { sameTabBarTabs, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import type { TemplateEntry } from "@/lib/ui-plugins/registry";
import { useSplitLayout } from "@/lib/ui-plugins/split-layout";
import { openTemplate } from "@/lib/ui-plugins/split-templates";
import { useUiPluginRegistry } from "@/lib/ui-plugins/store";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";

export function TableTabs() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const shownTabs = useRef<Tab[]>([]);
  const allTabs = useTableTabs((state) => {
    if (!sameTabBarTabs(shownTabs.current, state.tabs)) shownTabs.current = state.tabs;
    return shownTabs.current;
  });
  const tabs = allTabs.filter((tab) => isEasyModeTabVisible(tab, easyMode));
  const templates = useUiPluginRegistry((registry) => registry.templates);
  const tabGroups = useTabGroups(allTabs);
  const openQueryTab = useTableTabs((state) => state.openQueryTab);
  const orientation = useSplitView((state) => state.orientation);
  const setOrientation = useSplitView((state) => state.setOrientation);
  const paneCount = useSplitView((state) => state.panes.length);
  const collapse = useSplitView((state) => state.collapse);
  const layout = useSplitLayout();
  const activeGroup = useSplitView((state) => state.activeGroup);
  const groups = useSplitGroups();
  const renameGroup = useSplitView((state) => state.renameGroup);
  const deleteGroup = useSplitView((state) => state.deleteGroup);
  const openGroup = groups.find((group) => group.id === activeGroup);
  const groupFeature = useNewFeatureVisibility<HTMLButtonElement>("split.saved-views");
  const paneTabsNew = useHasNewFeatures("split.pane-tabs");
  const activeWorkspaceTab = useActiveWorkspaceTab();
  const pendingTab = useActiveWorkspaceTab(true);
  const router = useRouter();
  const navigate = useNavigate();
  const split = !easyMode && paneCount > 1 && Boolean(activeWorkspaceTab);
  const sideBySide = layout?.dir === "row";
  const rotateLabel =
    paneCount > 2
      ? "Anordnung drehen"
      : sideBySide
        ? "Bereiche untereinander"
        : "Bereiche nebeneinander";

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const el = navRef.current;
    if (!el || event.deltaY === 0 || event.shiftKey) return;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += event.deltaY;
  };

  const activeTab = activeWorkspaceTab;
  const isTabActive = (tab: Tab) => activeTab !== undefined && tabKey(tab) === tabKey(activeTab);
  const { containerRef, navRef, trackRef, overflow, hiddenKeys, revealTab } = useTabOverflow(
    pendingTab ? tabKey(pendingTab) : activeTab ? tabKey(activeTab) : undefined,
    split ? "" : tabs.map(tabKey).join("\0"),
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
  } = useTabClose({ tabs, activeTab: pendingTab ?? activeTab, navigate });

  const handleSplit = useCallback(() => {
    if (easyMode || tabs.length === 0 || !activeTab) return;
    useSplitView.getState().split({ activeKey: activeTab ? tabKey(activeTab) : null });
  }, [activeTab, tabs.length, easyMode]);

  useEffect(() => onHotkeyAction("view.split", handleSplit), [handleSplit]);

  const handleSplitTab = (tab: Tab, edge: SplitEdge) => {
    if (easyMode) return;
    useSplitView
      .getState()
      .split({ activeKey: activeTab ? tabKey(activeTab) : null, key: tabKey(tab), edge });
    const state = useSplitView.getState();
    if (state.panes[state.focusedPane] === tabKey(tab)) navigateToTab(navigate, tab);
  };

  const handleOpenGroup = (group: SplitGroup) => {
    if (split && group.id === activeGroup) return;
    const tab = useSplitView.getState().openGroup(group.id);
    if (tab) navigateToTab(navigate, tab);
  };

  const handleOpenTemplate = (entry: TemplateEntry) => {
    const tab = openTemplate(entry);
    if (tab) navigateToTab(navigate, tab);
  };

  const handleNewQueryTab = () => {
    const id = openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  };

  const handleOpenSqlFile = async () => {
    const id = await openSqlFileAsTab();
    if (id) void navigate({ to: "/query/$id", params: { id } });
  };

  const tabActions: TableTabActions = {
    preload: (tab) => preloadTab(router, tab),
    navigate: (tab) => navigateToTab(navigate, tab),
    close: handleClose,
    closeOthers: handleCloseOthers,
    closeToRight: handleCloseToRight,
    closeAll: handleCloseAll,
    split: handleSplitTab,
  };
  const actions = useRef(tabActions);
  actions.current = tabActions;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {split ? (
        openGroup && (
          <SplitGroupTab
            group={openGroup}
            onOpen={() => handleOpenGroup(openGroup)}
            onRename={(name) => renameGroup(openGroup.id, name)}
            onClose={collapse}
            onDelete={() => deleteGroup(openGroup.id)}
          />
        )
      ) : (
        <>
          <div ref={containerRef} className="flex min-w-0 items-center">
            <motion.nav
              layoutScroll
              ref={navRef}
              onWheel={handleWheel}
              aria-label="Geöffnete Objekte"
              className="no-scrollbar min-w-0 overflow-x-auto py-1"
            >
              <div ref={trackRef} className="relative flex w-max items-center gap-1 px-1">
                {tabs.map((tab, index) => {
                  const group = tabGroups?.[allTabs.indexOf(tab)];
                  const previous =
                    index > 0 ? tabGroups?.[allTabs.indexOf(tabs[index - 1])] : undefined;
                  return (
                    <Fragment key={tabKey(tab)}>
                      {group && group.id !== previous?.id && <TabGroupLabel group={group} />}
                      <TableTabsSortableTab
                        tab={tab}
                        index={allTabs.indexOf(tab)}
                        isActive={
                          pendingTab ? tabKey(pendingTab) === tabKey(tab) : isTabActive(tab)
                        }
                        isPending={Boolean(pendingTab && tabKey(pendingTab) === tabKey(tab))}
                        hasTabsToRight={index < tabs.length - 1}
                        tabsCount={tabs.length}
                        canSplit={!easyMode}
                        actions={actions}
                      />
                    </Fragment>
                  );
                })}
              </div>
            </motion.nav>
            {overflow && (
              <HiddenTabsMenu
                hiddenTabs={hiddenTabs}
                onSelect={(tab) => {
                  revealTab(tabKey(tab));
                  navigateToTab(navigate, tab);
                }}
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
        </>
      )}
      <div className="min-w-0 flex-1" />

      {!easyMode && (
        <Tooltip content="Ansicht teilen" side="bottom" wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={handleSplit}
            disabled={tabs.length === 0 || !activeTab || paneCount >= MAX_SPLIT_PANES}
            aria-label="Ansicht teilen"
            className={`${iconButton} relative`}
          >
            <SquareSplitHorizontalIcon className="size-3.5" />
            {paneTabsNew && !split && <NewBadge className="absolute -top-1.5 left-4" />}
          </button>
        </Tooltip>
      )}
      {split && (
        <Tooltip content={rotateLabel} side="bottom" wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={() => setOrientation(orientation === "horizontal" ? "vertical" : "horizontal")}
            aria-label={rotateLabel}
            className={iconButton}
          >
            <MorphIcon
              icon={paneCount > 2 ? RotateCwSquare : sideBySide ? Rows2 : Columns2}
              className="size-3.5"
            />
          </button>
        </Tooltip>
      )}
      {!easyMode && (groups.length > 0 || templates.length > 0) && (
        <SplitGroupsMenu
          groups={groups}
          activeGroup={split ? activeGroup : null}
          isNew={groupFeature.isNew}
          triggerRef={groupFeature.ref}
          onOpen={handleOpenGroup}
          onDelete={(group) => deleteGroup(group.id)}
          templates={templates}
          onOpenTemplate={handleOpenTemplate}
        />
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

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
import { InvestigationsButton } from "@/features/workbench/investigations-button";
import { isEasyModeTabVisible } from "@/lib/easy-mode";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { openSqlFileAsTab } from "@/lib/hooks/use-query-file";
import { useTabOverflow } from "@/lib/hooks/use-tab-overflow";
import { onHotkeyAction } from "@/lib/hotkeys";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { useSettingsStore } from "@/lib/settings";
import type { SplitEdge } from "@/lib/split-layout";
import {
  isSplitShown,
  MAX_SPLIT_PANES,
  openDetached,
  placeOpenTab,
  type SplitGroup,
  standaloneTabs,
  useForeignSplitGroups,
  useSplitGroups,
  useSplitShown,
  useSplitView,
} from "@/lib/split-view";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { useDropPreview } from "@/lib/tab-drop";
import { navigateToTab, preloadTab, tabLabel } from "@/lib/tab-navigation";
import { remoteTab, sameTabBarTabs, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import type { TemplateEntry } from "@/lib/ui-plugins/registry";
import { useSplitLayout } from "@/lib/ui-plugins/split-layout";
import { openTemplate } from "@/lib/ui-plugins/split-templates";
import { useUiPluginRegistry } from "@/lib/ui-plugins/store";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";
import { cn } from "@/lib/utils";

export function TableTabs() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const shownTabs = useRef<Tab[]>([]);
  const allTabs = useTableTabs((state) => {
    if (!sameTabBarTabs(shownTabs.current, state.tabs)) shownTabs.current = state.tabs;
    return shownTabs.current;
  });
  const templates = useUiPluginRegistry((registry) => registry.templates);
  const tabGroups = useTabGroups(allTabs);
  const openQueryTab = useTableTabs((state) => state.openQueryTab);
  const orientation = useSplitView((state) => state.orientation);
  const setOrientation = useSplitView((state) => state.setOrientation);
  const paneKeys = useSplitView((state) => state.panes);
  const paneTabs = useSplitView((state) => state.paneTabs);
  const collapse = useSplitView((state) => state.collapse);
  const layout = useSplitLayout();
  const activeGroup = useSplitView((state) => state.activeGroup);
  const groups = useSplitGroups();
  const foreignGroups = useForeignSplitGroups();
  const renameGroup = useSplitView((state) => state.renameGroup);
  const deleteGroup = useSplitView((state) => state.deleteGroup);
  const openGroup = groups.find((group) => group.id === activeGroup);
  const groupFeature = useNewFeatureVisibility<HTMLButtonElement>("split.saved-views");
  const sharedFeature = useNewFeatureVisibility<HTMLDivElement>("split.saved-views.shared");
  const setGroupShared = useSplitView((state) => state.setGroupShared);
  const masterFeature = useNewFeatureVisibility<HTMLButtonElement>("split.master-tabs");
  const seenFeatures = useSeenNewFeatures();
  const splitTabsNew =
    hasNewFeatures("split.pane-tabs", seenFeatures) ||
    hasNewFeatures("split.master-tabs", seenFeatures);
  const activeTab = useActiveWorkspaceTab();
  const pendingTab = useActiveWorkspaceTab(true);
  const router = useRouter();
  const navigate = useNavigate();
  const routeKey = activeTab ? tabKey(activeTab) : null;
  const latestKey = pendingTab ? tabKey(pendingTab) : routeKey;
  const paneCount = paneKeys.length;
  const hasSplit = !easyMode && paneCount > 1;
  const routeShown = useSplitShown(routeKey);
  const latestShown = useSplitShown(latestKey);
  const split = !easyMode && routeShown;
  const chipActive = !easyMode && latestShown;
  const tabs = standaloneTabs(
    allTabs.filter((tab) => isEasyModeTabVisible(tab, easyMode)),
    hasSplit ? paneTabs : [],
  );
  const caret = useDropPreview((state) =>
    state.preview?.pane === "master" && state.preview.at !== undefined
      ? (state.preview.x ?? null)
      : null,
  );
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

  const { containerRef, navRef, trackRef, overflow, hiddenKeys, revealTab } = useTabOverflow(
    chipActive ? undefined : (latestKey ?? undefined),
    tabs.map(tabKey).join("\0"),
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
    if (easyMode || !routeKey) return;
    const state = useSplitView.getState();
    const hidden = state.panes.length > 1 && !isSplitShown(state, routeKey);
    state.split({ activeKey: routeKey, key: hidden ? routeKey : null });
  }, [routeKey, easyMode]);

  useEffect(() => onHotkeyAction("view.split", handleSplit), [handleSplit]);

  const showTab = (tab: Tab) => {
    useSplitView.getState().reveal(tabKey(tab));
    navigateToTab(navigate, tab);
  };

  const handleSplitTab = (tab: Tab, edge: SplitEdge) => {
    if (easyMode) return;
    useSplitView.getState().split({ activeKey: routeKey, key: tabKey(tab), edge });
    const state = useSplitView.getState();
    if (state.panes[state.focusedPane] === tabKey(tab)) navigateToTab(navigate, tab);
  };

  const handleMoveTo = (tab: Tab, pane: number) => {
    useSplitView.getState().moveTab(tabKey(tab), pane);
    if (split || tabKey(tab) === routeKey) showTab(tab);
  };

  const handleShowSplit = () => {
    const state = useSplitView.getState();
    state.showSplit();
    const key = state.panes[state.focusedPane];
    const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
    if (tab) navigateToTab(navigate, tab);
  };

  const handleOpenGroup = async (group: SplitGroup, connectionId?: string) => {
    if (connectionId) {
      if (useConnectionSwitch.getState().isSwitching) return;
      if (!(await activateConnectionWithToast(connectionId))) return;
    } else if (hasSplit && group.id === activeGroup) {
      handleShowSplit();
      return;
    }
    const tab = useSplitView.getState().openGroup(group.id);
    if (tab) navigateToTab(navigate, tab);
  };

  const handleOpenTemplate = (entry: TemplateEntry) => {
    const tab = openTemplate(entry);
    if (tab) navigateToTab(navigate, tab);
  };

  const handleNewQueryTab = () => {
    const id = openDetached(openQueryTab);
    void navigate({ to: "/query/$id", params: { id } });
  };

  const handleOpenSqlFile = async () => {
    const id = await openSqlFileAsTab();
    if (id) void navigate({ to: "/query/$id", params: { id } });
  };

  const members = paneKeys.map((key) => {
    const tab = key ? (allTabs.find((entry) => tabKey(entry) === key) ?? remoteTab(key)) : null;
    return tab ? tabLabel(tab) : "Leer";
  });

  const tabActions: TableTabActions = {
    preload: (tab) => preloadTab(router, tab),
    navigate: showTab,
    close: handleClose,
    closeOthers: handleCloseOthers,
    closeToRight: handleCloseToRight,
    closeAll: handleCloseAll,
    split: handleSplitTab,
    moveTo: handleMoveTo,
    shift: (tab, delta) => {
      const key = tabKey(tab);
      const keys = tabs.map(tabKey);
      const rest = keys.filter((entry) => entry !== key);
      placeOpenTab(key, rest[keys.indexOf(key) + delta] ?? null);
    },
  };
  const actions = useRef(tabActions);
  actions.current = tabActions;

  return (
    <div
      data-drop-zone="master"
      className={cn(
        "relative flex min-w-0 flex-1 items-center gap-1 rounded-full transition-colors",
        caret !== null && "bg-primary/10 ring-1 ring-inset ring-primary/50",
      )}
    >
      {hasSplit && (
        <SplitGroupTab
          name={openGroup?.name ?? "Geteilte Ansicht"}
          members={members}
          active={chipActive}
          isNew={masterFeature.isNew}
          featureRef={masterFeature.ref}
          onOpen={handleShowSplit}
          onRename={openGroup ? (name) => renameGroup(openGroup.id, name) : undefined}
          onClose={collapse}
          onDelete={openGroup ? () => deleteGroup(openGroup.id) : undefined}
        />
      )}
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
              const key = tabKey(tab);
              return (
                <Fragment key={key}>
                  {group && group.id !== previous?.id && <TabGroupLabel group={group} />}
                  <TableTabsSortableTab
                    tab={tab}
                    index={index}
                    isActive={!chipActive && latestKey === key}
                    isPending={Boolean(pendingTab && tabKey(pendingTab) === key)}
                    paneCount={hasSplit ? paneCount : 0}
                    hasTabsToRight={index < tabs.length - 1}
                    tabsCount={tabs.length}
                    canSplit={!easyMode && paneCount < MAX_SPLIT_PANES}
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
              showTab(tab);
            }}
          />
        )}
      </div>
      <Tooltip content="Neue Abfrage öffnen" side="bottom" wrapperClassName="shrink-0">
        <button
          type="button"
          onClick={handleNewQueryTab}
          data-hotkey="tab.newQuery"
          aria-label="Neue Abfrage öffnen"
          className={`${iconButton} bg-primary/8 text-primary hover:bg-primary/15`}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </Tooltip>
      <div className="min-w-0 flex-1" />
      <InvestigationsButton />

      {!easyMode && (
        <Tooltip content="Ansicht teilen" side="bottom" wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={handleSplit}
            disabled={!routeKey || paneCount >= MAX_SPLIT_PANES}
            aria-label="Ansicht teilen"
            className={`${iconButton} relative`}
          >
            <SquareSplitHorizontalIcon className="size-3.5" />
            {splitTabsNew && !hasSplit && <NewBadge className="absolute -top-1.5 left-4" />}
          </button>
        </Tooltip>
      )}
      {hasSplit && (
        <Tooltip content={rotateLabel} side="bottom" wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={() => {
              setOrientation(orientation === "horizontal" ? "vertical" : "horizontal");
              if (!split) handleShowSplit();
            }}
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
      {!easyMode && (groups.length > 0 || foreignGroups.length > 0 || templates.length > 0) && (
        <SplitGroupsMenu
          groups={groups}
          foreign={foreignGroups}
          activeGroup={hasSplit ? activeGroup : null}
          isNew={groupFeature.isNew || sharedFeature.isNew}
          triggerRef={groupFeature.ref}
          sharedNew={sharedFeature.isNew}
          sharedRef={sharedFeature.ref}
          onToggleShared={(group, connectionId) =>
            setGroupShared(group.id, !group.shared, connectionId)
          }
          onOpen={(group, connectionId) => void handleOpenGroup(group, connectionId)}
          onDelete={(group, connectionId) => deleteGroup(group.id, connectionId)}
          templates={templates}
          onOpenTemplate={handleOpenTemplate}
        />
      )}
      {hasSplit && (
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
      {caret !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: caret }}
        />
      )}
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

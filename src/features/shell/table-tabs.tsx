import { useNavigate, useRouter } from "@tanstack/react-router";
import { Columns2, RotateCwSquare, Rows2 } from "lucide";
import { PlusIcon, SquareIcon, SquareSplitHorizontalIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import type * as React from "react";
import { Fragment, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/shallow";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import { CloseConfirmDialog } from "@/features/shell/table-tabs/close-confirm-dialog";
import { iconButton } from "@/features/shell/table-tabs/constants";
import { HiddenTabsMenu } from "@/features/shell/table-tabs/hidden-tabs-menu";
import { SharedTabDialog } from "@/features/shell/table-tabs/shared-tab-dialog";
import { SharedTabLinkHotkey } from "@/features/shell/table-tabs/shared-tab-link-hotkey";
import { SplitGroupTab } from "@/features/shell/table-tabs/split-group-tab";
import { SplitGroupsMenu } from "@/features/shell/table-tabs/split-groups-menu";
import { TransactionCloseDialog } from "@/features/shell/table-tabs/transaction-close-dialog";
import { useTabClose } from "@/features/shell/table-tabs/use-tab-close";
import {
  type TableTabActions,
  TableTabsSortableTab,
} from "@/features/shell/table-tabs-sortable-tab";
import { InvestigationsButton } from "@/features/workbench/investigations-button";
import { useActiveConnection } from "@/lib/connections";
import { isEasyModeTabVisible } from "@/lib/easy-mode";
import { useConnectionEnvironment } from "@/lib/environments";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useTabOverflow } from "@/lib/hooks/use-tab-overflow";
import { onHotkeyAction } from "@/lib/hotkeys";
import { tabListKeyDown } from "@/lib/keyboard-nav";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { useSettingsStore } from "@/lib/settings";
import type { SplitEdge } from "@/lib/split-layout";
import {
  groupPaneTabs,
  MAX_SPLIT_GROUPS,
  MAX_SPLIT_PANES,
  openDetached,
  parkedViews,
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
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";
import { useSplitLayout } from "@/lib/use-split-layout";
import { cn } from "@/lib/utils";

export function TableTabs() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const shownTabs = useRef<Tab[]>([]);
  const allTabs = useTableTabs((state) => {
    if (!sameTabBarTabs(shownTabs.current, state.tabs)) shownTabs.current = state.tabs;
    return shownTabs.current;
  });
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
  const parked = useSplitView(useShallow(parkedViews));
  const closeView = useSplitView((state) => state.closeView);
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
  const activeConnection = useActiveConnection();
  const environment = useConnectionEnvironment(activeConnection)?.value ?? null;
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
    easyMode
      ? []
      : [
          ...(hasSplit ? paneTabs : []),
          ...parked.flatMap((group) => groupPaneTabs(group).map((list) => list.map(tabKey))),
        ],
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
  const canSaveGroup = tabs.some((tab) => !(tab.kind === "tool" && tab.tool === "workbench"));

  const {
    pendingTransactions,
    setPendingTransactions,
    finishTransactions,
    pendingClose,
    setPendingClose,
    savingClose,
    saveAndClose,
    executeClose,
    handleClose,
    handleCloseOthers,
    handleCloseToRight,
    handleCloseAll,
    handleCloseGroup,
  } = useTabClose({ tabs, activeTab: pendingTab ?? activeTab, navigate });

  const handleSplit = useCallback(() => {
    if (easyMode || !routeKey) return;
    useSplitView.getState().split({ activeKey: routeKey });
  }, [routeKey, easyMode]);

  useEffect(() => onHotkeyAction("view.split", handleSplit), [handleSplit]);

  useEffect(() => {
    if (easyMode || !routeKey) return;
    const state = useSplitView.getState();
    if (state.paneTabs.some((list) => list.includes(routeKey))) return;
    const owner = parkedViews(state).find((group) =>
      groupPaneTabs(group).some((list) => list.some((tab) => tabKey(tab) === routeKey)),
    );
    if (!owner) return;
    state.openGroup(owner.id);
    useSplitView.getState().reveal(routeKey);
  }, [routeKey, easyMode]);

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

  const handleSwitchGroup = async (group: SplitGroup, connectionId: string) => {
    if (useConnectionSwitch.getState().isSwitching) return;
    if (!(await activateConnectionWithToast(connectionId))) return;
    const tab = useSplitView.getState().openGroup(group.id);
    if (tab) navigateToTab(navigate, tab);
  };

  const handleOpenGroup = (group: SplitGroup, connectionId?: string) => {
    if (connectionId && !activeConnection) {
      void handleSwitchGroup(group, connectionId);
      return;
    }
    const state = useSplitView.getState();
    const id = connectionId ? state.adoptGroup(group.id, connectionId) : group.id;
    if (!id) {
      toast.error(`„${group.name}“ lässt sich hier nicht öffnen`);
      return;
    }
    if (hasSplit && id === activeGroup) {
      handleShowSplit();
      return;
    }
    const tab = state.openGroup(id);
    if (tab) navigateToTab(navigate, tab);
  };

  const handleSaveGroup = (group?: SplitGroup) => {
    const id = useSplitView.getState().saveTabs(chipActive ? null : latestKey, group?.id);
    if (!id)
      toast.error(
        group
          ? `„${group.name}“ gibt es nicht mehr`
          : `Höchstens ${MAX_SPLIT_GROUPS} Tab-Gruppen je Verbindung`,
      );
    else if (group) toast.success(`„${group.name}“ aktualisiert`);
    return id;
  };

  const handleNewQueryTab = () => {
    const id = openDetached(openQueryTab);
    void navigate({ to: "/query/$id", params: { id } });
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

  const liveChip = !easyMode && hasSplit && (
    <SplitGroupTab
      name={openGroup?.name ?? "Geteilte Ansicht"}
      members={members}
      active={chipActive}
      isNew={masterFeature.isNew}
      featureRef={masterFeature.ref}
      onOpen={handleShowSplit}
      onRename={openGroup ? (name) => renameGroup(openGroup.id, name) : undefined}
      onClose={collapse}
      onCloseTabs={() => handleCloseGroup(paneTabs.flat())}
      onDelete={openGroup ? () => deleteGroup(openGroup.id) : undefined}
      shared={openGroup?.shared}
      onToggleShared={openGroup ? () => setGroupShared(openGroup.id, !openGroup.shared) : undefined}
      others={groups.filter((group) => group.id !== openGroup?.id)}
      onOpenGroup={handleOpenGroup}
    />
  );

  return (
    <div
      data-drop-zone="master"
      className={cn(
        "relative flex min-w-0 flex-1 items-center gap-1 rounded-full transition-colors",
        caret !== null && "bg-primary/10 ring-1 ring-inset ring-primary/50",
      )}
    >
      {!openGroup && liveChip}
      {!easyMode &&
        groups.map((group) =>
          group.id === openGroup?.id ? (
            <Fragment key={group.id}>{liveChip}</Fragment>
          ) : parked.includes(group) ? (
            <SplitGroupTab
              key={group.id}
              name={group.name}
              members={group.tabs.map((tab) => (tab ? tabLabel(tab) : "Leer"))}
              active={false}
              onOpen={() => handleOpenGroup(group)}
              onRename={(name) => renameGroup(group.id, name)}
              onClose={() => closeView(group.id)}
              onDelete={() => deleteGroup(group.id)}
              shared={group.shared}
              onToggleShared={() => setGroupShared(group.id, !group.shared)}
              others={groups.filter((entry) => entry.id !== group.id)}
              onOpenGroup={handleOpenGroup}
            />
          ) : null,
        )}
      <div ref={containerRef} className="flex min-w-0 items-center">
        <motion.nav
          layoutScroll
          ref={navRef}
          onWheel={handleWheel}
          aria-label="Geöffnete Objekte"
          className="no-scrollbar min-w-0 overflow-x-auto py-1"
        >
          <div
            ref={trackRef}
            role="tablist"
            aria-orientation="horizontal"
            onKeyDown={tabListKeyDown}
            className="relative flex w-max items-center gap-1 px-1"
          >
            {tabs.map((tab, index) => {
              const key = tabKey(tab);
              return (
                <TableTabsSortableTab
                  key={key}
                  tab={tab}
                  index={index}
                  isActive={!chipActive && latestKey === key}
                  isPending={Boolean(pendingTab && tabKey(pendingTab) === key)}
                  paneCount={hasSplit ? paneCount : 0}
                  connectionId={activeConnection?.id ?? null}
                  environment={environment}
                  hasTabsToRight={index < tabs.length - 1}
                  tabsCount={tabs.length}
                  canSplit={!easyMode && paneCount < MAX_SPLIT_PANES}
                  actions={actions}
                />
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
      <div className="flex shrink-0 items-center rounded-full bg-primary/8">
        <Tooltip
          content="Neue Abfrage öffnen"
          hotkey="tab.newQuery"
          side="bottom"
          wrapperClassName="shrink-0"
        >
          <button
            type="button"
            data-feature="query.new-tab"
            onClick={handleNewQueryTab}
            data-hotkey="tab.newQuery"
            aria-label="Neue Abfrage öffnen"
            className={cn(
              iconButton,
              "text-primary hover:bg-primary/15 hover:text-primary",
              !easyMode && "rounded-r-none",
            )}
          >
            <PlusIcon className="size-3.5" />
          </button>
        </Tooltip>
        {!easyMode && (
          <SplitGroupsMenu
            onNewQuery={handleNewQueryTab}
            groups={groups}
            foreign={foreignGroups}
            activeGroup={hasSplit ? activeGroup : null}
            canSave={canSaveGroup}
            onSave={handleSaveGroup}
            onSwitch={(group, connectionId) => void handleSwitchGroup(group, connectionId)}
            onRename={(group, name) => renameGroup(group.id, name)}
            isNew={groupFeature.isNew || sharedFeature.isNew}
            triggerRef={groupFeature.ref}
            sharedNew={sharedFeature.isNew}
            sharedRef={sharedFeature.ref}
            onToggleShared={(group, connectionId) =>
              setGroupShared(group.id, !group.shared, connectionId)
            }
            onOpen={handleOpenGroup}
            onDelete={(group, connectionId) => deleteGroup(group.id, connectionId)}
          />
        )}
      </div>
      <div className="min-w-0 flex-1" />
      <InvestigationsButton />

      {!easyMode && (
        <Tooltip
          content="Ansicht teilen"
          hotkey="view.split"
          side="bottom"
          wrapperClassName="shrink-0"
        >
          <button
            data-feature="view.split"
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
      <SharedTabLinkHotkey />
      {caret !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: caret }}
        />
      )}
      <SharedTabDialog />
      <TransactionCloseDialog
        pending={pendingTransactions}
        setPending={setPendingTransactions}
        finish={finishTransactions}
      />
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

import { useNavigate, useRouter } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import type * as React from "react";
import { Fragment, useRef } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import { CloseConfirmDialog } from "@/features/shell/table-tabs/close-confirm-dialog";
import { HiddenTabsMenu } from "@/features/shell/table-tabs/hidden-tabs-menu";
import { TabGroupLabel } from "@/features/shell/table-tabs/tab-group-label";
import { useTabClose } from "@/features/shell/table-tabs/use-tab-close";
import { useTabGroups } from "@/features/shell/table-tabs/use-tab-groups";
import {
  type TableTabActions,
  TableTabsSortableTab,
} from "@/features/shell/table-tabs-sortable-tab";
import { useConnectionsStore } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useTabOverflow } from "@/lib/hooks/use-tab-overflow";
import { MAX_SPLIT_PANES, usePaneTabList, useSplitView } from "@/lib/split-view";
import { useDropPreview } from "@/lib/tab-drop";
import { navigateToTab, preloadTab } from "@/lib/tab-navigation";
import { remoteTab, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";
import { cn } from "@/lib/utils";

export function PaneTabStrip({ index, focused }: { index: number; focused: boolean }) {
  const tabs = usePaneTabList(index);
  const active = useSplitView((state) => state.panes[index] ?? null);
  const paneCount = useSplitView((state) => state.panes.length);
  const connections = useConnectionsStore((state) => state.connections);
  const routeTab = useActiveWorkspaceTab();
  const pendingTab = useActiveWorkspaceTab(true);
  const navigate = useNavigate();
  const router = useRouter();
  const groups = useTabGroups(tabs);
  const group = `pane-${index}`;
  const keys = tabs.map(tabKey);
  const { containerRef, navRef, trackRef, overflow, hiddenKeys, revealTab } = useTabOverflow(
    active ?? undefined,
    keys.join("\0"),
  );
  const feature = useNewFeatureVisibility<HTMLDivElement>(
    index === 0 ? "split.pane-tabs" : undefined,
  );
  const close = useTabClose({
    tabs,
    activeTab: pendingTab ?? routeTab,
    navigate,
    listen: false,
  });
  const caret = useDropPreview((state) =>
    state.preview?.pane === index && state.preview.at !== undefined
      ? (state.preview.x ?? null)
      : null,
  );

  const show = (tab: Tab) => {
    useSplitView.getState().reveal(tabKey(tab));
    if (!remoteTab(tabKey(tab))) navigateToTab(navigate, tab);
  };
  const showFocused = () => {
    const state = useSplitView.getState();
    const key = state.panes[state.focusedPane];
    const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
    if (tab) navigateToTab(navigate, tab);
  };
  const newQuery = () => {
    useSplitView.getState().focusPane(index);
    const id = useTableTabs.getState().openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  };

  const tabActions: TableTabActions = {
    preload: (tab) => {
      if (!remoteTab(tabKey(tab))) preloadTab(router, tab);
    },
    navigate: show,
    close: close.handleClose,
    closeOthers: close.handleCloseOthers,
    closeToRight: close.handleCloseToRight,
    closeAll: close.handleCloseAll,
    split: (tab, edge) => {
      useSplitView.getState().split({
        activeKey: routeTab ? tabKey(routeTab) : null,
        key: tabKey(tab),
        target: index,
        edge,
      });
      showFocused();
    },
    moveTo: (tab, pane) => {
      useSplitView.getState().moveTab(tabKey(tab), pane);
      showFocused();
    },
  };
  const actions = useRef(tabActions);
  actions.current = tabActions;

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const el = navRef.current;
    if (!el || event.deltaY === 0 || event.shiftKey) return;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += event.deltaY;
  };

  const colorOf = (tab: Tab) => {
    const id = remoteTab(tabKey(tab))?.connectionId;
    return id ? (connections.find((entry) => entry.id === id)?.color ?? "#64748b") : null;
  };

  return (
    <div
      ref={feature.ref}
      data-pane-strip={index}
      data-drop-zone={`strip:${index}`}
      role="toolbar"
      aria-label={`Tab-Leiste Bereich ${index + 1}`}
      onDoubleClick={(event) => {
        const { target } = event;
        if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
        if (!target.closest("button")) newQuery();
      }}
      className={cn(
        "relative flex h-full min-w-0 flex-1 items-center gap-0.5 rounded-md transition-colors",
        caret !== null && "bg-primary/10 ring-1 ring-inset ring-primary/50",
      )}
    >
      <div ref={containerRef} className="flex min-w-0 items-center">
        <nav
          ref={navRef}
          onWheel={handleWheel}
          aria-label={`Tabs in Bereich ${index + 1}`}
          className="no-scrollbar min-w-0 overflow-x-auto"
        >
          <div ref={trackRef} className="relative flex w-max items-center gap-0.5 px-0.5">
            {tabs.map((tab, position) => {
              const label = groups?.[position];
              const previous = position > 0 ? groups?.[position - 1] : undefined;
              const key = tabKey(tab);
              return (
                <Fragment key={key}>
                  {label && label.id !== previous?.id && <TabGroupLabel group={label} />}
                  <TableTabsSortableTab
                    tab={tab}
                    index={position}
                    group={group}
                    pane={index}
                    paneCount={paneCount}
                    isActive={key === active}
                    dimmed={!focused}
                    isPending={Boolean(pendingTab && tabKey(pendingTab) === key)}
                    color={colorOf(tab)}
                    hasTabsToRight={position < tabs.length - 1}
                    tabsCount={tabs.length}
                    canSplit={paneCount < MAX_SPLIT_PANES}
                    actions={actions}
                  />
                </Fragment>
              );
            })}
          </div>
        </nav>
        {overflow && (
          <HiddenTabsMenu
            hiddenTabs={tabs.filter((tab) => hiddenKeys.includes(tabKey(tab)))}
            onSelect={(tab) => {
              revealTab(tabKey(tab));
              show(tab);
            }}
          />
        )}
      </div>
      <Tooltip content="Neue Abfrage in diesem Bereich" side="bottom" wrapperClassName="shrink-0">
        <button
          type="button"
          onClick={newQuery}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={`Neue Abfrage in Bereich ${index + 1}`}
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </Tooltip>
      {feature.isNew && <NewBadge className="shrink-0" />}
      {caret !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: caret }}
        />
      )}
      <CloseConfirmDialog
        pendingClose={close.pendingClose}
        setPendingClose={close.setPendingClose}
        savingClose={close.savingClose}
        saveAndClose={close.saveAndClose}
        executeClose={close.executeClose}
      />
    </div>
  );
}

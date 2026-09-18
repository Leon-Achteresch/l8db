import { useNavigate } from "@tanstack/react-router";
import { Columns2, Rows2 } from "lucide";
import {
  ChevronDownIcon,
  FolderOpenIcon,
  PlusIcon,
  SquareIcon,
  SquareSplitHorizontalIcon,
} from "lucide-react";
import { MorphIcon } from "morphicons/react";
import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Tooltip } from "@/components/motion/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableTabsSortableTab } from "@/features/shell/table-tabs-sortable-tab";
import { copyText } from "@/lib/clipboard";
import { openSqlFileAsTab, saveQueryTabFile } from "@/lib/hooks/use-query-file";
import { useTabOverflow } from "@/lib/hooks/use-tab-overflow";
import { onHotkeyAction } from "@/lib/hotkeys";
import { MAX_SPLIT_PANES, useSplitView } from "@/lib/split-view";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import {
  isQueryTabDirty,
  queryNeedsCloseConfirmation,
  type Tab,
  tabKey,
  useTableTabs,
} from "@/lib/table-tabs";
import { useActiveWorkspaceTab, useTabRouteMatch } from "@/lib/use-active-workspace-tab";

const tabHistory: string[] = [];

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-200 hover:bg-muted hover:text-foreground motion-safe:active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

export function TableTabs() {
  const tabs = useTableTabs((state) => state.tabs);
  const closeTab = useTableTabs((state) => state.closeTab);
  const closeOtherTabs = useTableTabs((state) => state.closeOtherTabs);
  const closeTabsToRight = useTableTabs((state) => state.closeTabsToRight);
  const closeAllTabs = useTableTabs((state) => state.closeAllTabs);
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
  const navigate = useNavigate();
  const split = panes.length > 1;
  const orientationLabel =
    orientation === "horizontal" ? "Bereiche untereinander" : "Bereiche nebeneinander";
  const [pendingClose, setPendingClose] = useState<
    { type: "tab" | "others" | "right"; key: string } | { type: "all" } | null
  >(null);

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const el = navRef.current;
    if (!el || event.deltaY === 0 || event.shiftKey) return;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += event.deltaY;
  };

  const isTabActive = (tab: Tab) => (split ? panes[focusedPane] === tabKey(tab) : matchTab(tab));

  const activeTab = tabs.find(isTabActive) ?? activeWorkspaceTab;
  const { containerRef, navRef, trackRef, overflow, hiddenKeys, revealTab } = useTabOverflow(
    activeTab ? tabKey(activeTab) : undefined,
    tabs,
  );
  const hiddenTabs = tabs.filter((tab) => hiddenKeys.includes(tabKey(tab)));

  const closeTabNow = (tab: Tab) => {
    const key = tabKey(tab);
    const wasActive = isTabActive(tab);
    if (!wasActive) {
      closeTab(key);
      return;
    }
    const index = tabs.findIndex((t) => tabKey(t) === key);
    const recent = tabHistory.find(
      (entry) => entry !== key && tabs.some((t) => tabKey(t) === entry),
    );
    const next = tabs.find((t) => tabKey(t) === recent) ?? tabs[index + 1] ?? tabs[index - 1];
    void Promise.resolve(next ? navigateToTab(navigate, next) : navigate({ to: "/" })).finally(() =>
      closeTab(key),
    );
  };

  useEffect(() => {
    if (!activeTab) return;
    const key = tabKey(activeTab);
    const at = tabHistory.indexOf(key);
    if (at !== -1) tabHistory.splice(at, 1);
    tabHistory.unshift(key);
    tabHistory.length = Math.min(tabHistory.length, 50);
  }, [activeTab]);

  const [savingClose, setSavingClose] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  const saveAndClose = async () => {
    if (!pendingClose || savingClose) return;
    const pending = pendingClose;
    setSavingClose(true);
    try {
      for (const key of pendingKeys) {
        const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
        if (
          tab?.kind === "query" &&
          queryNeedsCloseConfirmation(tab) &&
          !(await saveQueryTabFile(tab.id))
        )
          return;
      }
      const changed = useTableTabs
        .getState()
        .tabs.some(
          (tab) =>
            pendingKeys.includes(tabKey(tab)) &&
            tab.kind === "query" &&
            queryNeedsCloseConfirmation(tab),
        );
      if (changed) {
        toast.warning("Ein Entwurf wurde während des Speicherns geändert. Bitte erneut speichern.");
        return;
      }
      setPendingClose(null);
      executeClose(pending);
    } finally {
      setSavingClose(false);
    }
  };

  const requestClose = (pending: NonNullable<typeof pendingClose>, closingTabs: Tab[]) => {
    if (closingTabs.some((tab) => tab.kind === "query" && queryNeedsCloseConfirmation(tab))) {
      setPendingKeys(closingTabs.map(tabKey));
      setPendingClose(pending);
      return;
    }
    executeClose(pending);
  };

  const executeClose = (pending: NonNullable<typeof pendingClose>) => {
    if (pending.type === "tab") {
      const tab = tabs.find((entry) => tabKey(entry) === pending.key);
      if (tab) closeTabNow(tab);
      return;
    }
    if (pending.type === "others") {
      const tab = tabs.find((entry) => tabKey(entry) === pending.key);
      if (tab) closeOthersNow(tab);
      return;
    }
    if (pending.type === "right") {
      const tab = tabs.find((entry) => tabKey(entry) === pending.key);
      if (tab) closeToRightNow(tab);
      return;
    }
    collapse();
    void navigate({ to: "/" }).finally(closeAllTabs);
  };

  const handleClose = (tab: Tab) => {
    const key = tabKey(tab);
    requestClose({ type: "tab", key }, [tab]);
  };

  const closeOthersNow = (tab: Tab) => {
    void Promise.resolve(navigateToTab(navigate, tab)).finally(() => closeOtherTabs(tabKey(tab)));
  };

  const closeToRightNow = (tab: Tab) => {
    const index = tabs.findIndex((t) => tabKey(t) === tabKey(tab));
    const remaining = tabs.slice(0, index + 1);
    if (activeTab && !remaining.some((t) => tabKey(t) === tabKey(activeTab))) {
      void Promise.resolve(navigateToTab(navigate, tab)).finally(() =>
        closeTabsToRight(tabKey(tab)),
      );
      return;
    }
    closeTabsToRight(tabKey(tab));
  };

  const handleCloseOthers = (tab: Tab) => {
    const key = tabKey(tab);
    requestClose(
      { type: "others", key },
      tabs.filter((entry) => tabKey(entry) !== key),
    );
  };

  const handleCloseToRight = (tab: Tab) => {
    const index = tabs.findIndex((entry) => tabKey(entry) === tabKey(tab));
    requestClose({ type: "right", key: tabKey(tab) }, tabs.slice(index + 1));
  };

  const handleCloseAll = () => {
    requestClose({ type: "all" }, tabs);
  };

  useEffect(() => {
    const onCloseRequest = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      const tab = useTableTabs.getState().tabs.find((entry) => tabKey(entry) === key);
      if (tab) requestClose({ type: "tab", key }, [tab]);
    };
    window.addEventListener("l8db:request-close-tab", onCloseRequest);
    return () => window.removeEventListener("l8db:request-close-tab", onCloseRequest);
  });

  const handleSplit = useCallback(() => {
    const key = activeTab ? tabKey(activeTab) : tabs[0] ? tabKey(tabs[0]) : null;
    addPane(key);
    if (!activeTab && tabs[0]) navigateToTab(navigate, tabs[0]);
  }, [activeTab, addPane, navigate, tabs]);

  useEffect(() => onHotkeyAction("view.split", handleSplit), [handleSplit]);

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
    void copyText(value);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div ref={containerRef} className="flex min-w-0 items-center">
        <nav
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
          </div>
        </nav>
        {overflow && (
          <DropdownMenu>
            <Tooltip
              content={`Weitere geöffnete Objekte (${hiddenTabs.length})`}
              side="bottom"
              wrapperClassName="shrink-0"
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Weitere geöffnete Objekte (${hiddenTabs.length})`}
                  className={`${iconButton} w-11 gap-0.5 bg-primary/8 text-primary`}
                >
                  <ChevronDownIcon className="size-3.5" />
                  <span className="text-[10px] tabular-nums">{hiddenTabs.length}</span>
                </button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel>Weitere geöffnete Objekte</DropdownMenuLabel>
              {hiddenTabs.map((tab) => (
                <DropdownMenuItem
                  key={tabKey(tab)}
                  onSelect={() => {
                    revealTab(tabKey(tab));
                    if (split) reveal(tabKey(tab));
                    navigateToTab(navigate, tab);
                  }}
                  title={tabLabel(tab)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{tabLabel(tab)}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {"schema" in tab
                        ? tab.schema
                        : tab.kind === "query"
                          ? "SQL-Abfrage"
                          : tab.kind}
                    </span>
                  </span>
                  {tab.kind === "query" && isQueryTabDirty(tab) && (
                    <span
                      role="img"
                      className="text-amber-500"
                      aria-label="Ungespeicherte Änderungen"
                    >
                      ●
                    </span>
                  )}
                  {tab.kind === "query" && tab.externalChange && (
                    <span role="img" className="text-amber-500" aria-label="Datei extern geändert">
                      !
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
      {panes.length === 2 && (
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
      <AlertDialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open && !savingClose) setPendingClose(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle>
            <AlertDialogDescription>
              SQL-Dateien und Entwürfe wurden noch nicht gespeichert. Geschlossene Tabs bleiben in
              der Entwurfswiederherstellung verfügbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingClose}>Abbrechen</AlertDialogCancel>
            <Button disabled={savingClose} onClick={() => void saveAndClose()}>
              {savingClose ? "Speichern…" : "Speichern und schließen"}
            </Button>
            <AlertDialogAction
              variant="destructive"
              disabled={savingClose}
              onClick={() => {
                if (!pendingClose) return;
                const pending = pendingClose;
                setPendingClose(null);
                executeClose(pending);
              }}
            >
              Verwerfen und schließen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

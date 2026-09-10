import type * as React from "react";

import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { CopyIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { tabKey, useTableTabs, type TableTab } from "@/lib/table-tabs";

export function TableTabs() {
  const tabs = useTableTabs((state) => state.tabs);
  const closeTab = useTableTabs((state) => state.closeTab);
  const closeOtherTabs = useTableTabs((state) => state.closeOtherTabs);
  const closeTabsToRight = useTableTabs((state) => state.closeTabsToRight);
  const closeAllTabs = useTableTabs((state) => state.closeAllTabs);
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();

  if (tabs.length === 0) {
    return null;
  }

  const isTabActive = (tab: TableTab) =>
    Boolean(matchRoute({ to: "/tables/$schema/$table", params: tab }));

  const activeTab = tabs.find(isTabActive);

  const navigateToTab = (tab: TableTab) =>
    navigate({ to: "/tables/$schema/$table", params: tab });

  const handleClose = (tab: TableTab) => {
    const wasActive = isTabActive(tab);
    const index = tabs.findIndex(
      (existing) => tabKey(existing) === tabKey(tab),
    );
    closeTab(tab);
    if (!wasActive) {
      return;
    }
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (next) {
      navigateToTab(next);
    } else {
      navigate({ to: "/" });
    }
  };

  const handleCloseOthers = (tab: TableTab) => {
    closeOtherTabs(tab);
    navigateToTab(tab);
  };

  const handleCloseToRight = (tab: TableTab) => {
    const index = tabs.findIndex(
      (existing) => tabKey(existing) === tabKey(tab),
    );
    const remaining = tabs.slice(0, index + 1);
    closeTabsToRight(tab);
    if (
      activeTab &&
      !remaining.some((existing) => tabKey(existing) === tabKey(activeTab))
    ) {
      navigateToTab(tab);
    }
  };

  const handleCloseAll = () => {
    closeAllTabs();
    navigate({ to: "/" });
  };

  const handleAuxClick = (event: React.MouseEvent, tab: TableTab) => {
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    handleClose(tab);
  };

  const handleCopy = (value: string) => {
    void navigator.clipboard.writeText(value);
  };

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const index = tabs.findIndex(
          (existing) => tabKey(existing) === tabKey(tab),
        );
        const isActive = isTabActive(tab);
        const hasTabsToRight = index < tabs.length - 1;
        return (
          <ContextMenu key={tabKey(tab)}>
            <ContextMenuTrigger asChild>
              <Link
                to="/tables/$schema/$table"
                params={tab}
                onAuxClick={(event) => handleAuxClick(event, tab)}
                onMouseDown={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                  }
                }}
                className={cn(
                  "group flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-sm transition-colors",
                  isActive
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span className="max-w-40 truncate">{tab.table}</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleClose(tab);
                  }}
                  aria-label={`${tab.table} schließen`}
                  className="-mr-1 rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100"
                >
                  <XIcon className="size-3.5" />
                </button>
              </Link>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem onSelect={() => handleClose(tab)}>
                Schließen
                <ContextMenuShortcut>
                  <XIcon className="size-3.5" />
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                disabled={tabs.length <= 1}
                onSelect={() => handleCloseOthers(tab)}
              >
                Andere schließen
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!hasTabsToRight}
                onSelect={() => handleCloseToRight(tab)}
              >
                Tabs rechts schließen
              </ContextMenuItem>
              <ContextMenuItem onSelect={handleCloseAll}>
                Alle schließen
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => handleCopy(tab.table)}>
                Tabellenname kopieren
                <ContextMenuShortcut>
                  <CopyIcon className="size-3.5" />
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => handleCopy(tabKey(tab))}>
                Vollständigen Namen kopieren
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </nav>
  );
}

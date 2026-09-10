import type * as React from "react";

import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { CopyIcon, PlusIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints } from "@dnd-kit/dom";

import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { tabKey, useTableTabs, type Tab } from "@/lib/table-tabs";

interface SortableTabProps {
  tab: Tab;
  index: number;
  isActive: boolean;
  hasTabsToRight: boolean;
  tabsCount: number;
  onNavigate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  onAuxClick: (event: React.MouseEvent) => void;
  onMouseDown: (event: React.MouseEvent) => void;
  onCopyTable?: () => void;
  onCopyFull?: () => void;
}

function SortableTab({
  tab,
  index,
  isActive,
  hasTabsToRight,
  tabsCount,
  onNavigate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onAuxClick,
  onMouseDown,
  onCopyTable,
  onCopyFull,
}: SortableTabProps) {
  const { ref, isDragging } = useSortable({ id: tabKey(tab), index });

  const label = tab.kind === "table" ? tab.table : tab.title;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={ref}
          onAuxClick={onAuxClick}
          onMouseDown={onMouseDown}
          className={cn(
            "group flex shrink-0 cursor-grab items-center rounded-md border text-sm transition-colors active:cursor-grabbing",
            isActive
              ? "border-border bg-accent text-accent-foreground"
              : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            isDragging && "opacity-50",
          )}
        >
          <button
            type="button"
            onClick={onNavigate}
            className="flex max-w-40 items-center gap-1.5 truncate px-3 py-1 text-left"
          >
            {tab.kind === "query" && (
              <SquareTerminalIcon className="size-3 shrink-0 opacity-60" />
            )}
            <span className="truncate">{label}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${label} schließen`}
            className="mr-1 rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={onClose}>
          Schließen
          <ContextMenuShortcut>
            <XIcon className="size-3.5" />
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={tabsCount <= 1} onSelect={onCloseOthers}>
          Andere schließen
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasTabsToRight} onSelect={onCloseToRight}>
          Tabs rechts schließen
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>Alle schließen</ContextMenuItem>
        {tab.kind === "table" && onCopyTable && onCopyFull && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onCopyTable}>
              Tabellenname kopieren
              <ContextMenuShortcut>
                <CopyIcon className="size-3.5" />
              </ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCopyFull}>
              Vollständigen Namen kopieren
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [
      new PointerActivationConstraints.Distance({ value: 5 }),
    ],
    preventActivation: () => false,
  }),
];

export function TableTabs() {
  const tabs = useTableTabs((state) => state.tabs);
  const closeTab = useTableTabs((state) => state.closeTab);
  const closeOtherTabs = useTableTabs((state) => state.closeOtherTabs);
  const closeTabsToRight = useTableTabs((state) => state.closeTabsToRight);
  const closeAllTabs = useTableTabs((state) => state.closeAllTabs);
  const reorderTabs = useTableTabs((state) => state.reorderTabs);
  const openQueryTab = useTableTabs((state) => state.openQueryTab);
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();

  const isTabActive = (tab: Tab) => {
    if (tab.kind === "table") {
      return Boolean(
        matchRoute({
          to: "/tables/$schema/$table",
          params: { schema: tab.schema, table: tab.table },
          search:
            (tab.entityType ?? "table") === "view" ? { type: "view" } : {},
        }),
      );
    }
    return Boolean(matchRoute({ to: "/query/$id", params: { id: tab.id } }));
  };

  const activeTab = tabs.find(isTabActive);

  const navigateToTab = (tab: Tab) => {
    if (tab.kind === "table") {
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: tab.schema, table: tab.table },
        search:
          (tab.entityType ?? "table") === "view" ? { type: "view" } : {},
      });
    } else {
      void navigate({ to: "/query/$id", params: { id: tab.id } });
    }
  };

  const handleClose = (tab: Tab) => {
    const key = tabKey(tab);
    const wasActive = isTabActive(tab);
    const index = tabs.findIndex((t) => tabKey(t) === key);
    closeTab(key);
    if (!wasActive) return;
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (next) {
      navigateToTab(next);
    } else {
      void navigate({ to: "/" });
    }
  };

  const handleCloseOthers = (tab: Tab) => {
    closeOtherTabs(tabKey(tab));
    navigateToTab(tab);
  };

  const handleCloseToRight = (tab: Tab) => {
    const index = tabs.findIndex((t) => tabKey(t) === tabKey(tab));
    const remaining = tabs.slice(0, index + 1);
    closeTabsToRight(tabKey(tab));
    if (
      activeTab &&
      !remaining.some((t) => tabKey(t) === tabKey(activeTab))
    ) {
      navigateToTab(tab);
    }
  };

  const handleCloseAll = () => {
    closeAllTabs();
    void navigate({ to: "/" });
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

  const handleCopy = (value: string) => {
    void navigator.clipboard.writeText(value);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <DragDropProvider
        sensors={sensors}
        onDragEnd={(event) => {
          const { operation, canceled } = event;
          if (!canceled && isSortable(operation.source)) {
            const source = operation.source;
            if (source.initialIndex !== source.index) {
              reorderTabs(source.initialIndex, source.index);
            }
          }
        }}
      >
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab, index) => (
            <SortableTab
              key={tabKey(tab)}
              tab={tab}
              index={index}
              isActive={isTabActive(tab)}
              hasTabsToRight={index < tabs.length - 1}
              tabsCount={tabs.length}
              onNavigate={() => navigateToTab(tab)}
              onClose={() => handleClose(tab)}
              onCloseOthers={() => handleCloseOthers(tab)}
              onCloseToRight={() => handleCloseToRight(tab)}
              onCloseAll={handleCloseAll}
              onAuxClick={(event) => handleAuxClick(event, tab)}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onCopyTable={
                tab.kind === "table"
                  ? () => handleCopy(tab.table)
                  : undefined
              }
              onCopyFull={
                tab.kind === "table"
                  ? () => handleCopy(`${tab.schema}.${tab.table}`)
                  : undefined
              }
            />
          ))}
        </nav>
      </DragDropProvider>

      <button
        type="button"
        onClick={handleNewQueryTab}
        title="Neue Abfrage öffnen"
        className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}

import type * as React from "react";

import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { CopyIcon, XIcon } from "lucide-react";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { useSortable, isSortableOperation } from "@dnd-kit/react/sortable";
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
import { tabKey, useTableTabs, type TableTab } from "@/lib/table-tabs";

interface SortableTabProps {
  tab: TableTab;
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
  onCopyTable: () => void;
  onCopyFull: () => void;
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
            className="max-w-40 truncate px-3 py-1 text-left"
          >
            {tab.table}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${tab.table} schließen`}
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
      </ContextMenuContent>
    </ContextMenu>
  );
}

const sensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
];

export function TableTabs() {
  const tabs = useTableTabs((state) => state.tabs);
  const closeTab = useTableTabs((state) => state.closeTab);
  const closeOtherTabs = useTableTabs((state) => state.closeOtherTabs);
  const closeTabsToRight = useTableTabs((state) => state.closeTabsToRight);
  const closeAllTabs = useTableTabs((state) => state.closeAllTabs);
  const reorderTabs = useTableTabs((state) => state.reorderTabs);
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
    <DragDropProvider
      sensors={sensors}
      onDragEnd={(event) => {
        const { operation, canceled } = event;
        if (!canceled && isSortableOperation(operation) && operation.source) {
          reorderTabs(operation.source.initialIndex, operation.source.index);
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
              if (event.button === 1) {
                event.preventDefault();
              }
            }}
            onCopyTable={() => handleCopy(tab.table)}
            onCopyFull={() => handleCopy(tabKey(tab))}
          />
        ))}
      </nav>
    </DragDropProvider>
  );
}

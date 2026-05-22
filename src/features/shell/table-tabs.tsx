import type * as React from "react";
import { useRef } from "react";

import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  CopyIcon,
  BracesIcon,
  EyeIcon,
  PackageIcon,
  PlusIcon,
  SquareTerminalIcon,
  TableIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
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

function tabVisual(tab: Tab) {
  switch (tab.kind) {
    case "query":
      return { Icon: SquareTerminalIcon, iconColor: "text-sky-500" };
    case "function":
      return { Icon: BracesIcon, iconColor: "text-violet-500" };
    case "extension":
      return { Icon: PackageIcon, iconColor: "text-amber-500" };
    case "role":
      return { Icon: UsersIcon, iconColor: "text-rose-500" };
    case "trigger":
      return { Icon: ZapIcon, iconColor: "text-orange-500" };
    case "view-editor":
      return { Icon: EyeIcon, iconColor: "text-cyan-500" };
    default:
      return (tab.entityType ?? "table") === "view"
        ? { Icon: EyeIcon, iconColor: "text-cyan-500" }
        : { Icon: TableIcon, iconColor: "text-emerald-500" };
  }
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

  const { Icon, iconColor } = tabVisual(tab);

  const label =
    tab.kind === "table"
      ? tab.table
      : tab.kind === "query"
        ? tab.title
        : tab.kind === "function"
          ? tab.name
          : tab.kind === "trigger"
            ? tab.trigger
            : tab.kind === "view-editor"
              ? tab.view
              : tab.name;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={ref}
          onAuxClick={onAuxClick}
          onMouseDown={onMouseDown}
          className={cn(
            "group relative flex h-8 shrink-0 cursor-grab items-center rounded-lg border pl-2.5 pr-1 text-sm transition-all active:cursor-grabbing",
            isActive
              ? "border-border bg-card text-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-accent/50 hover:text-foreground",
            isDragging && "z-10 cursor-grabbing opacity-90 shadow-md ring-1 ring-ring/40",
          )}
        >
          <span
            className={cn(
              "mr-2 size-1.5 shrink-0 rounded-full transition-colors",
              isActive ? "bg-primary" : "bg-transparent",
            )}
          />
          <button
            type="button"
            onClick={onNavigate}
            className="flex max-w-44 items-center gap-2 truncate py-1 text-left"
          >
            <Icon className={cn("size-3.5 shrink-0", iconColor)} />
            <span className="truncate font-medium">{label}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${label} schließen`}
            className={cn(
              "ml-1.5 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-all hover:bg-foreground/10 hover:text-foreground",
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
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
  const navRef = useRef<HTMLElement>(null);

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const el = navRef.current;
    if (!el || event.deltaY === 0 || event.shiftKey) return;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += event.deltaY;
  };

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
    if (tab.kind === "query") {
      return Boolean(matchRoute({ to: "/query/$id", params: { id: tab.id } }));
    }
    if (tab.kind === "function") {
      return Boolean(
        matchRoute({
          to: "/functions/$schema/$name",
          params: { schema: tab.schema, name: tab.name },
          search: { oid: tab.oid },
        }),
      );
    }
    if (tab.kind === "role") {
      return Boolean(
        matchRoute({ to: "/users/$name", params: { name: tab.name } }),
      );
    }
    if (tab.kind === "trigger") {
      return Boolean(
        matchRoute({
          to: "/triggers/$schema/$table/$trigger",
          params: { schema: tab.schema, table: tab.table, trigger: tab.trigger },
        }),
      );
    }
    if (tab.kind === "view-editor") {
      return Boolean(
        matchRoute({
          to: "/view-editor/$schema/$view",
          params: { schema: tab.schema, view: tab.view },
        }),
      );
    }
    return Boolean(
      matchRoute({ to: "/extensions/$name", params: { name: tab.name } }),
    );
  };

  const activeTab = tabs.find(isTabActive);

  const navigateToTab = (tab: Tab) => {
    if (tab.kind === "table") {
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: tab.schema, table: tab.table },
        search: () =>
          (tab.entityType ?? "table") === "view"
            ? { type: "view" as const }
            : {},
      });
    } else if (tab.kind === "query") {
      void navigate({ to: "/query/$id", params: { id: tab.id } });
    } else if (tab.kind === "function") {
      void navigate({
        to: "/functions/$schema/$name",
        params: { schema: tab.schema, name: tab.name },
        search: { oid: tab.oid },
      });
    } else if (tab.kind === "role") {
      void navigate({ to: "/users/$name", params: { name: tab.name } });
    } else if (tab.kind === "trigger") {
      void navigate({
        to: "/triggers/$schema/$table/$trigger",
        params: { schema: tab.schema, table: tab.table, trigger: tab.trigger },
      });
    } else if (tab.kind === "view-editor") {
      void navigate({
        to: "/view-editor/$schema/$view",
        params: { schema: tab.schema, view: tab.view },
      });
    } else {
      void navigate({ to: "/extensions/$name", params: { name: tab.name } });
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
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
        <nav
          ref={navRef}
          onWheel={handleWheel}
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-2"
        >
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
        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border/60 hover:bg-accent hover:text-foreground"
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}

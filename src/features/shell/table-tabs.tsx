import type * as React from "react";
import { useRef } from "react";

import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints } from "@dnd-kit/dom";

import { TableTabsSortableTab } from "@/features/shell/table-tabs-sortable-tab";
import { tabKey, useTableTabs, type Tab } from "@/lib/table-tabs";

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
            <TableTabsSortableTab
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

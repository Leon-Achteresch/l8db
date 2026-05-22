import type * as React from "react";

import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { tabKey, useTableTabs, type TableTab } from "@/lib/table-tabs";

export function TableTabs() {
  const tabs = useTableTabs((state) => state.tabs);
  const closeTab = useTableTabs((state) => state.closeTab);
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();

  if (tabs.length === 0) {
    return null;
  }

  const handleClose = (event: React.MouseEvent, tab: TableTab) => {
    event.preventDefault();
    event.stopPropagation();
    const wasActive = Boolean(
      matchRoute({ to: "/tables/$schema/$table", params: tab }),
    );
    const index = tabs.findIndex(
      (existing) => tabKey(existing) === tabKey(tab),
    );
    closeTab(tab);
    if (!wasActive) {
      return;
    }
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (next) {
      navigate({ to: "/tables/$schema/$table", params: next });
    } else {
      navigate({ to: "/" });
    }
  };

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = Boolean(
          matchRoute({ to: "/tables/$schema/$table", params: tab }),
        );
        return (
          <Link
            key={tabKey(tab)}
            to="/tables/$schema/$table"
            params={tab}
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
              onClick={(event) => handleClose(event, tab)}
              aria-label={`${tab.table} schließen`}
              className="-mr-1 rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
          </Link>
        );
      })}
    </nav>
  );
}

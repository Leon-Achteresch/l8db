import { type useNavigate, useRouter } from "@tanstack/react-router";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSplitView } from "@/lib/split-view";
import { navigateToTab, preloadTab, tabLabel } from "@/lib/tab-navigation";
import { isQueryTabDirty, type Tab, tabKey } from "@/lib/table-tabs";
import { iconButton } from "./constants";

interface HiddenTabsMenuProps {
  hiddenTabs: Tab[];
  split: boolean;
  revealTab: (key: string) => void;
  navigate: ReturnType<typeof useNavigate>;
}

export function HiddenTabsMenu({ hiddenTabs, split, revealTab, navigate }: HiddenTabsMenuProps) {
  const router = useRouter();
  const reveal = useSplitView((state) => state.reveal);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matchingTabs = hiddenTabs.filter((tab) =>
    `${tabLabel(tab)} ${"schema" in tab ? tab.schema : tab.kind}`
      .toLocaleLowerCase()
      .includes(query),
  );
  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch("")}>
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
      <DropdownMenuContent
        align="end"
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>Weitere geöffnete Objekte</DropdownMenuLabel>
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border bg-popover px-2 py-1.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
                event.stopPropagation();
              }
            }}
            aria-label="Geöffnete Objekte suchen"
            placeholder="Objekt suchen…"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        {matchingTabs.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            Kein geöffnetes Objekt gefunden.
          </p>
        )}
        {matchingTabs.map((tab) => (
          <DropdownMenuItem
            key={tabKey(tab)}
            onPointerEnter={() => preloadTab(router, tab)}
            onFocus={() => preloadTab(router, tab)}
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
                {"schema" in tab ? tab.schema : tab.kind === "query" ? "SQL-Abfrage" : tab.kind}
              </span>
            </span>
            {tab.kind === "query" && isQueryTabDirty(tab) && (
              <span role="img" className="text-amber-500" aria-label="Ungespeicherte Änderungen">
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
  );
}

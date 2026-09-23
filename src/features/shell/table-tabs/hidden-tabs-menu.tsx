import { type useNavigate, useRouter } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
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
  return (
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

import {
  ChevronDownIcon,
  CodeIcon,
  Columns2Icon,
  GaugeIcon,
  HistoryIcon,
  LayersIcon,
  NetworkIcon,
  PuzzleIcon,
  ShieldCheckIcon,
  ShieldIcon,
  TableIcon,
  ZapIcon,
} from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettingsStore } from "@/lib/settings";
import { type TABLE_DETAIL_TABS, tableDetailTabGroup } from "@/lib/table-detail-tabs";
import { cn } from "@/lib/utils";

const icons = {
  data: TableIcon,
  columns: Columns2Icon,
  definition: CodeIcon,
  triggers: ZapIcon,
  indexes: LayersIcon,
  constraints: ShieldCheckIcon,
  rls: ShieldIcon,
  partitions: NetworkIcon,
  grants: ShieldCheckIcon,
  "used-by": NetworkIcon,
  performance: GaugeIcon,
  audit: HistoryIcon,
};

const groupOf = tableDetailTabGroup;

export function TableDetailTabBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: typeof TABLE_DETAIL_TABS;
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  const hidden = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const setVisible = useSettingsStore((s) => s.setTableDetailTabVisible);
  const reset = useSettingsStore((s) => s.resetTableDetailTabs);
  const visible = tabs
    .filter((tab) => !hidden.includes(tab.id))
    .sort((a, b) => groupOf(a.id) - groupOf(b.id));
  const navRef = useRef<HTMLElement>(null);
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const overflowKey = visible.map((tab) => tab.id).join(",");

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !overflowKey) return;
    const measure = () => {
      const limit = nav.getBoundingClientRect().right + 1;
      const next = Array.from(nav.querySelectorAll<HTMLElement>("[data-tab-id]"))
        .filter((tab) => tab.getBoundingClientRect().right > limit)
        .map((tab) => tab.dataset.tabId ?? "");
      setOverflowIds((current) => (current.join(",") === next.join(",") ? current : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    if (nav.firstElementChild) observer.observe(nav.firstElementChild);
    return () => observer.disconnect();
  }, [overflowKey]);

  const overflow = visible.filter((tab) => overflowIds.includes(tab.id));
  const activeOverflow = overflow.find((tab) => tab.id === activeTab);
  const ActiveIcon = activeOverflow
    ? (icons[activeOverflow.id as keyof typeof icons] ?? PuzzleIcon)
    : null;

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <nav
            ref={navRef}
            className="h-8 min-w-0 flex-1 overflow-hidden"
            aria-label="Tabellenansichten, per Rechtsklick anpassen"
          >
            {visible.length ? (
              <TabsList
                variant="line"
                className="w-max gap-0 group-data-horizontal/tabs:h-8"
                aria-label="Tabellenansichten"
              >
                {visible.map((tab, index) => {
                  const Icon = icons[tab.id as keyof typeof icons] ?? PuzzleIcon;
                  const previous = visible[index - 1];
                  const clipped = overflowIds.includes(tab.id);
                  return (
                    <Fragment key={tab.id}>
                      {previous && groupOf(previous.id) !== groupOf(tab.id) && (
                        <span
                          aria-hidden="true"
                          className={cn("mx-2 h-4 w-px shrink-0 bg-border", clipped && "invisible")}
                        />
                      )}
                      <TabsTrigger
                        value={tab.id}
                        data-tab-id={tab.id}
                        className={cn("px-1.5", clipped && "invisible")}
                        tabIndex={clipped ? -1 : undefined}
                        aria-hidden={clipped || undefined}
                      >
                        <Icon className="size-3.5" strokeWidth={1.75} />
                        {tab.label}
                      </TabsTrigger>
                    </Fragment>
                  );
                })}
              </TabsList>
            ) : (
              <div className="flex h-8 items-center text-xs text-muted-foreground">
                Keine Tabs sichtbar · Rechtsklick zum Anpassen
              </div>
            )}
          </nav>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Sichtbare Tabs · global</ContextMenuLabel>
          {tabs.map((tab) => (
            <ContextMenuCheckboxItem
              key={tab.id}
              checked={!hidden.includes(tab.id)}
              onCheckedChange={(checked) => setVisible(tab.id, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              {tab.label}
            </ContextMenuCheckboxItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={reset}>Alle Tabs einblenden</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {overflow.length > 0 && (
        <span aria-hidden="true" className="mx-2 h-4 w-px shrink-0 bg-border" />
      )}
      {overflow.length > 0 && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 min-w-8 shrink-0 gap-1.5 px-1.5 text-sm font-medium text-foreground/60 hover:text-foreground dark:text-muted-foreground",
                activeOverflow && "bg-muted font-semibold text-foreground dark:text-foreground",
              )}
              aria-label={
                activeOverflow
                  ? `Weitere Ansichten, aktiv: ${activeOverflow.label}`
                  : "Weitere Ansichten"
              }
            >
              {ActiveIcon && <ActiveIcon className="size-3.5" strokeWidth={1.75} />}
              {activeOverflow ? activeOverflow.label : "Weitere"}
              <ChevronDownIcon className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {overflow.map((tab) => {
              const Icon = icons[tab.id as keyof typeof icons] ?? PuzzleIcon;
              return (
                <DropdownMenuItem
                  key={tab.id}
                  onSelect={() => onTabChange(tab.id)}
                  aria-current={tab.id === activeTab || undefined}
                  className={cn(tab.id === activeTab && "bg-accent/60 font-medium")}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  {tab.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

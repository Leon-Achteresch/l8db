import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  Columns2Icon,
  GaugeIcon,
  HistoryIcon,
  LayersIcon,
  NetworkIcon,
  ShieldCheckIcon,
  ShieldIcon,
  TableIcon,
  ZapIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type WheelEvent } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettingsStore } from "@/lib/settings";
import type { TABLE_DETAIL_TABS } from "@/lib/table-detail-tabs";

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

export function TableDetailTabBar({
  tabs,
  activeTab,
}: {
  tabs: typeof TABLE_DETAIL_TABS;
  activeTab: string;
}) {
  const hidden = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const setVisible = useSettingsStore((s) => s.setTableDetailTabVisible);
  const reset = useSettingsStore((s) => s.resetTableDetailTabs);
  const visible = tabs.filter((tab) => !hidden.includes(tab.id));
  const scrollRef = useRef<HTMLElement>(null);
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });

  const updateScrollState = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const next = {
      overflow: scroll.scrollWidth > scroll.clientWidth + 1,
      left: scroll.scrollLeft > 1,
      right: scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1,
    };
    setScrollState((current) =>
      current.overflow === next.overflow &&
      current.left === next.left &&
      current.right === next.right
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(scroll);
    if (visible.length && scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    updateScrollState();
    return () => observer.disconnect();
  }, [updateScrollState, visible.length]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scrollState.overflow) return;
    const active = Array.from(scroll?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []).find(
      (tab) => tab.dataset.tabId === activeTab,
    );
    if (!scroll || !active) return;
    const scrollBounds = scroll.getBoundingClientRect();
    const activeBounds = active.getBoundingClientRect();
    if (activeBounds.left < scrollBounds.left) {
      scroll.scrollLeft += activeBounds.left - scrollBounds.left;
    } else if (activeBounds.right > scrollBounds.right) {
      scroll.scrollLeft += activeBounds.right - scrollBounds.right;
    }
    updateScrollState();
  }, [activeTab, scrollState.overflow, updateScrollState]);

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    const scroll = scrollRef.current;
    if (!scroll || !scrollState.overflow || Math.abs(event.deltaX) >= Math.abs(event.deltaY))
      return;
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? scroll.clientWidth : 1);
    const next = Math.max(
      0,
      Math.min(scroll.scrollWidth - scroll.clientWidth, scroll.scrollLeft + delta),
    );
    if (next === scroll.scrollLeft) return;
    event.preventDefault();
    scroll.scrollLeft = next;
  };

  const scrollBy = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({
      left: direction * Math.max(120, (scrollRef.current?.clientWidth ?? 0) * 0.7),
      behavior: "smooth",
    });
  };

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <nav
            ref={scrollRef}
            onScroll={updateScrollState}
            onWheel={handleWheel}
            className="h-9 min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Tabellenansichten, per Rechtsklick anpassen"
          >
            {visible.length ? (
              <TabsList variant="line" className="h-9 w-max" aria-label="Tabellenansichten">
                {visible.map((tab) => {
                  const Icon = icons[tab.id];
                  return (
                    <TabsTrigger key={tab.id} value={tab.id} data-tab-id={tab.id}>
                      <Icon className="size-3.5" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            ) : (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
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
      {scrollState.overflow && (
        <div className="ml-1 flex shrink-0 items-center border-l border-border/70 pl-1">
          <button
            type="button"
            aria-label="Tabs nach links scrollen"
            disabled={!scrollState.left}
            onClick={() => scrollBy(-1)}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Tabs nach rechts scrollen"
            disabled={!scrollState.right}
            onClick={() => scrollBy(1)}
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

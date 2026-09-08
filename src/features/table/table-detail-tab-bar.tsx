import {
  CodeIcon,
  Columns2Icon,
  GaugeIcon,
  HistoryIcon,
  LayersIcon,
  NetworkIcon,
  ShieldIcon,
  TableIcon,
  ZapIcon,
} from "lucide-react";
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
  rls: ShieldIcon,
  partitions: NetworkIcon,
  "used-by": NetworkIcon,
  performance: GaugeIcon,
  audit: HistoryIcon,
};

export function TableDetailTabBar({ tabs }: { tabs: typeof TABLE_DETAIL_TABS }) {
  const hidden = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const setVisible = useSettingsStore((s) => s.setTableDetailTabVisible);
  const reset = useSettingsStore((s) => s.resetTableDetailTabs);
  const visible = tabs.filter((tab) => !hidden.includes(tab.id));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="group"
          className="h-9 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          aria-label="Tabbar anpassen per Rechtsklick"
        >
          {visible.length ? (
            <TabsList variant="line" className="h-9" aria-label="Tabellenansichten">
              {visible.map((tab) => {
                const Icon = icons[tab.id];
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="group-data-horizontal/tabs:after:bottom-0"
                  >
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
        </div>
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
  );
}

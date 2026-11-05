import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/lib/settings";
import { TABLE_DETAIL_TAB_GROUPS, TABLE_DETAIL_TABS } from "@/lib/table-detail-tabs";

export function SettingsTableTabs() {
  const hidden = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const setVisible = useSettingsStore((s) => s.setTableDetailTabVisible);
  const reset = useSettingsStore((s) => s.resetTableDetailTabs);

  return (
    <section
      data-setting-id="table-tabs"
      tabIndex={-1}
      className="space-y-3 border-b border-border/60 pb-[calc(1rem+var(--ui-density-step))] outline-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            Tabbar für Tabellen & Views
            {hidden.length > 0 ? (
              <Badge variant="secondary" className="text-[10px]">
                Geändert
              </Badge>
            ) : null}
          </h3>
          <p className="mt-0.5 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
            Sichtbare Tabs für alle Verbindungen festlegen. Auch per Rechtsklick auf die Tabbar. Je
            nach Datenbank und Objekttyp sind nicht alle Tabs verfügbar.
          </p>
        </div>
        {hidden.length > 0 ? (
          <Button variant="outline" size="sm" onClick={reset}>
            Alle einblenden
          </Button>
        ) : null}
      </div>
      <div className="-mx-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        {[0, 1].map((column) => (
          <div key={column} className="flex min-w-0 flex-1 flex-col gap-3">
            {TABLE_DETAIL_TAB_GROUPS.filter((_, index) => index % 2 === column).map((group) => (
              <div key={group.label} className="min-w-0">
                <h4 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </h4>
                <div className="divide-y divide-border/50">
                  {TABLE_DETAIL_TABS.filter((tab) => group.ids.includes(tab.id)).map((tab) => (
                    <label
                      key={tab.id}
                      className="flex h-8 cursor-pointer items-center justify-between gap-3 px-2 text-control transition-colors hover:bg-muted/60"
                    >
                      <span className="truncate">
                        {tab.label}
                        {tab.entity === "view" ? " (Views)" : ""}
                      </span>
                      <Switch
                        checked={!hidden.includes(tab.id)}
                        onCheckedChange={(checked) => setVisible(tab.id, checked)}
                        aria-label={`${tab.label} anzeigen`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

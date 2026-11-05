import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/lib/settings";
import { TABLE_DETAIL_TABS } from "@/lib/table-detail-tabs";

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
      <div className="grid max-w-3xl gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {TABLE_DETAIL_TABS.map((tab) => (
          <label key={tab.id} className="flex items-center gap-3 text-[13px]">
            <Switch
              checked={!hidden.includes(tab.id)}
              onCheckedChange={(checked) => setVisible(tab.id, checked)}
              aria-label={`${tab.label} anzeigen`}
            />
            <span>
              {tab.label}
              {tab.entity === "view" ? " (Views)" : ""}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

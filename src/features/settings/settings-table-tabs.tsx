import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/lib/settings";
import { TABLE_DETAIL_TABS } from "@/lib/table-detail-tabs";

export function SettingsTableTabs() {
  const hidden = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const setVisible = useSettingsStore((s) => s.setTableDetailTabVisible);
  const reset = useSettingsStore((s) => s.resetTableDetailTabs);

  return (
    <section className="space-y-3 rounded-2xl border border-border/80 bg-card px-4 py-3.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Tabbar für Tabellen & Views</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Sichtbare Tabs für alle Verbindungen festlegen. Auch per Rechtsklick auf die Tabbar.
            Je nach Datenbank und Objekttyp sind nicht alle Tabs verfügbar.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reset} disabled={hidden.length === 0}>
          Alle einblenden
        </Button>
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {TABLE_DETAIL_TABS.map((tab) => (
          <label key={tab.id} className="flex items-center justify-between gap-4 text-sm">
            <span>{tab.label}{tab.entity === "view" ? " (Views)" : ""}</span>
            <Switch
              checked={!hidden.includes(tab.id)}
              onCheckedChange={(checked) => setVisible(tab.id, checked)}
              aria-label={`${tab.label} anzeigen`}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

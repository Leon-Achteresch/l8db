import { Check, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/lib/settings";
import { TABLE_DETAIL_TABS } from "@/lib/table-detail-tabs";
import { cn } from "@/lib/utils";

export function SettingsTableTabs() {
  const hidden = useSettingsStore((s) => s.hiddenTableDetailTabs);
  const setVisible = useSettingsStore((s) => s.setTableDetailTabVisible);
  const reset = useSettingsStore((s) => s.resetTableDetailTabs);

  return (
    <section
      data-setting-id="table-tabs"
      tabIndex={-1}
      className="space-y-2.5 pb-[calc(1rem+var(--ui-density-step))] outline-none"
    >
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Tabbar für Tabellen & Views</h3>
        {hidden.length > 0 && (
          <>
            <Badge variant="secondary" className="text-[10px]">
              Geändert
            </Badge>
            <Button variant="ghost" size="xs" onClick={reset} className="text-muted-foreground">
              Alle einblenden
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TABLE_DETAIL_TABS.map((tab) => {
          const visible = !hidden.includes(tab.id);
          const Icon = visible ? Check : Plus;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={visible}
              aria-label={`${tab.label} anzeigen`}
              onClick={() => setVisible(tab.id, !visible)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-3 pl-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]",
                visible
                  ? "bg-secondary font-medium text-foreground hover:bg-secondary/80"
                  : "text-muted-foreground ring-1 ring-border ring-inset hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon aria-hidden className="size-3" />
              {tab.label}
              {tab.entity === "view" ? " (Views)" : ""}
            </button>
          );
        })}
      </div>
    </section>
  );
}

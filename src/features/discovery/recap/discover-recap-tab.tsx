import { ImageDown } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DiscoverFeatureCard } from "@/features/discovery/discover-feature-card";
import type { DatabaseKind } from "@/lib/db";
import { useActiveCapabilities } from "@/lib/db-selection";
import { FEATURE_CATALOG, featureAvailable } from "@/lib/discovery/catalog";
import { computeRecap, formatDuration, recapYear } from "@/lib/discovery/recap/model";
import { useRecapStore } from "@/lib/discovery/recap/store";
import { useFeatureUsage } from "@/lib/discovery/usage";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { providerForKind } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { usageStatisticsStore } from "@/lib/usage-statistics";

function familyLabel(kind: string): string {
  return providerForKind(kind as DatabaseKind)?.name ?? kind;
}

export function DiscoverRecapTab() {
  const enabled = useSettingsStore((state) => state.localUsageStats);
  const setEnabled = useSettingsStore((state) => state.setLocalUsageStats);
  const easyMode = useSettingsStore((state) => state.easyMode);
  const capabilities = useActiveCapabilities();
  const statistics = useSyncExternalStore(
    usageStatisticsStore.subscribe,
    usageStatisticsStore.getSnapshot,
    usageStatisticsStore.getSnapshot,
  );
  const usage = useFeatureUsage();
  const days = useRecapStore((state) => state.days);
  const longest = useRecapStore((state) => state.longest);
  const [saving, setSaving] = useState(false);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.recap");
  const year = recapYear() ?? new Date().getFullYear();

  const recap = useMemo(
    () =>
      computeRecap({
        year,
        statistics,
        usage,
        days,
        longestMs: longest.year === year ? longest.ms : 0,
        catalog: FEATURE_CATALOG.filter((entry) =>
          featureAvailable(entry, { capabilities, easyMode }),
        ),
      }),
    [year, statistics, usage, days, longest, capabilities, easyMode],
  );

  const save = async () => {
    setSaving(true);
    try {
      const { saveRecapPng } = await import("@/lib/discovery/recap/image");
      if (await saveRecapPng(recap, familyLabel)) toast.success("Bild gespeichert");
    } catch (error) {
      toast.error("Bild konnte nicht gespeichert werden", { description: String(error) });
    } finally {
      setSaving(false);
    }
  };

  const stats: [string, string][] = [
    ["Abfragen", recap.queries.toLocaleString("de-DE")],
    ["Operationen", recap.operations.toLocaleString("de-DE")],
    ["Längste Operation", recap.longestMs > 0 ? formatDuration(recap.longestMs) : "–"],
    ["Aktivster Monat", recap.activeMonth ?? "–"],
    ["Aktivster Tag", recap.activeWeekday ?? "–"],
    ["Aktive Tage", recap.activeDays.toLocaleString("de-DE")],
  ];

  return (
    <div ref={ref} className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          Dein l8db-Jahr {year}
          {isNew && <NewBadge />}
        </h2>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={saving || recap.empty}
          onClick={() => void save()}
        >
          <ImageDown />
          Als Bild speichern
        </Button>
      </div>

      {!enabled && (
        <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-4 text-sm">
          <span className="flex-1 text-muted-foreground">Nutzungsstatistik ist aus</span>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Lokale Nutzungsstatistik erfassen"
          />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-muted/40 p-4">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
          </div>
        ))}
      </dl>

      {recap.families.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Datenbanken</h3>
          <ol className="flex flex-wrap gap-2">
            {recap.families.map((row) => (
              <li key={row.kind} className="rounded-full bg-muted/40 px-3 py-1 text-sm">
                {familyLabel(row.kind)}
                <span className="ml-2 tabular-nums text-muted-foreground">{row.count}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {recap.topFeatures.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Meistgenutzt</h3>
          <ol className="space-y-1">
            {recap.topFeatures.map((feature, index) => (
              <li key={feature.id} className="flex items-baseline gap-3 text-sm">
                <span className="w-4 tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="flex-1">{feature.title}</span>
                <span className="tabular-nums text-muted-foreground">{feature.count}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {recap.neverTried.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Noch nie ausprobiert</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {recap.neverTried.map((feature) => (
              <DiscoverFeatureCard key={feature.id} feature={feature} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

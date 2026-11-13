import { ChartNoAxesCombined, Download, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { FeatureEmptyState } from "@/components/feature-empty-state/feature-empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { SettingsUsageAreas } from "@/features/settings/settings-usage-areas";
import { SettingsUsageOperations } from "@/features/settings/settings-usage-operations";
import {
  formatUsageActivity,
  formatUsageCount,
  formatUsageDate,
  summarizeUsageStatistics,
} from "@/features/settings/usage-statistics-format";
import { useUsageStatistics } from "@/lib/hooks/use-usage-statistics";
import { useSettingsStore } from "@/lib/settings";
import { clearUsageStatistics, exportUsageStatistics } from "@/lib/usage-statistics";
import { cn } from "@/lib/utils";

export function SettingsUsageTab() {
  const statistics = useUsageStatistics();
  const summary = useMemo(() => summarizeUsageStatistics(statistics), [statistics]);
  const localUsageStats = useSettingsStore((state) => state.localUsageStats);
  const setLocalUsageStats = useSettingsStore((state) => state.setLocalUsageStats);
  const usageMetrics = useSettingsStore((state) => state.usageMetrics);
  const setUsageMetrics = useSettingsStore((state) => state.setUsageMetrics);

  const downloadStatistics = () => {
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([exportUsageStatistics()], { type: "application/json" }));
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `l8db-nutzungsstatistik-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
    } catch {
      toast.error("Nutzungsstatistik konnte nicht exportiert werden");
    } finally {
      anchor?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold tracking-tight">Nutzungsstatistik</h2>

      <SettingsRow settingId="local-usage-statistics" featureId="settings.statistics.overview">
        <Switch
          checked={localUsageStats}
          onCheckedChange={setLocalUsageStats}
          aria-label="Lokale Nutzungsstatistik erfassen"
        />
      </SettingsRow>

      <p className="-mt-4 pb-2 text-xs text-muted-foreground">
        Bleibt auf diesem Gerät. SQL, Ergebnisdaten, Namen, Verbindungsdaten und Fehlermeldungen
        werden nicht erfasst.
      </p>

      <SettingsRow settingId="usage-metrics">
        <Switch
          checked={usageMetrics}
          onCheckedChange={setUsageMetrics}
          aria-label="Nutzungs- und Leistungsdaten an Sentry senden"
        />
      </SettingsRow>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 text-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                localUsageStats ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {localUsageStats ? "Erfassung aktiv" : "Erfassung pausiert"}
          </span>
          <span className="tabular-nums">Stand {formatUsageDate(statistics.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={downloadStatistics}
            disabled={!summary.hasActivity}
          >
            <Download className="size-3.5" />
            JSON exportieren
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={!summary.hasActivity}>
                <Trash2 className="size-3.5" />
                Zurücksetzen
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lokale Nutzungsstatistik zurücksetzen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Alle bisher lokal erfassten Werte werden gelöscht. Die Einstellungen zur Erfassung
                  und zur Entwickleranalyse bleiben erhalten. Bereits an Sentry gesendete Daten
                  werden dadurch nicht gelöscht.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    clearUsageStatistics();
                    toast.success("Lokale Nutzungsstatistik zurückgesetzt");
                  }}
                >
                  Statistik löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 @min-[24rem]:grid-cols-3">
        {[
          { label: "Fenstersitzungen", value: formatUsageCount(statistics.sessionCount) },
          { label: "Aktive Vordergrundzeit", value: formatUsageActivity(summary.activeMs) },
          { label: "Erfasste Vorgänge", value: formatUsageCount(summary.operationCount) },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl bg-muted/40 px-4 py-3">
            <dt className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              {metric.label}
            </dt>
            <dd className="mt-1.5 text-2xl font-medium tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>

      {!summary.hasActivity ? (
        <FeatureEmptyState
          icon={ChartNoAxesCombined}
          title="Noch keine Nutzungsdaten"
          action={
            localUsageStats
              ? undefined
              : { label: "Erfassung aktivieren", onClick: () => setLocalUsageStats(true) }
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Zeitraum ab {formatUsageDate(statistics.startedAt)} ·{" "}
            {formatUsageCount(summary.viewOpens)} Bereichsaufrufe. Aktivität zählt nur im
            sichtbaren, fokussierten Fenster nach Bedienung; längere Leerlaufzeit wird nicht
            mitgezählt.
          </p>
          <SettingsUsageAreas summary={summary} />
          <SettingsUsageOperations summary={summary} startup={statistics.startup} />
        </>
      )}
    </div>
  );
}

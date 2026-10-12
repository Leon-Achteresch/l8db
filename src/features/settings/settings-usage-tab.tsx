import { ChartNoAxesCombined, Download, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
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
      <div>
        <h2 className="text-base font-semibold tracking-tight">Nutzungsstatistik</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Deine Nutzung dieser Installation: Bereiche, Bedienwege, Vordergrundaktivität und
          Datenbankvorgänge der letzten 32 Fenstersitzungen. Jedes geöffnete App-Fenster zählt als
          eigene Sitzung. Die Übersicht wird bei Ereignissen aktualisiert.
        </p>
      </div>

      <SettingsRow settingId="local-usage-statistics" featureId="settings.statistics.overview">
        <Switch
          checked={localUsageStats}
          onCheckedChange={setLocalUsageStats}
          aria-label="Lokale Nutzungsstatistik erfassen"
        />
      </SettingsRow>

      <div className="rounded-xl border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        Die lokale Statistik bleibt auf diesem Gerät. SQL, Ergebnisdaten, Namen, Verbindungsdaten
        und Fehlermeldungen werden nicht erfasst. Die Entwickleranalyse ist eine separate,
        freiwillige Einstellung und sendet bei Aktivierung aggregierte Nutzungs- und Leistungsdaten
        an Sentry (EU).
      </div>

      <SettingsRow settingId="usage-metrics">
        <Switch
          checked={usageMetrics}
          onCheckedChange={setUsageMetrics}
          aria-label="Nutzungs- und Leistungsdaten senden"
        />
      </SettingsRow>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={localUsageStats ? "secondary" : "outline"}>
            {localUsageStats ? "Erfassung aktiv" : "Erfassung pausiert"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Stand: {formatUsageDate(statistics.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={downloadStatistics}
            disabled={!summary.hasActivity}
          >
            <Download className="size-3.5" />
            JSON exportieren
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={!summary.hasActivity}>
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
          <div key={metric.label} className="rounded-xl border p-4">
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="mt-2 text-xl font-semibold tabular-nums">{metric.value}</dd>
          </div>
        ))}
      </dl>

      {!summary.hasActivity ? (
        <div className="rounded-xl border border-dashed px-6 py-8 text-center">
          <ChartNoAxesCombined
            aria-hidden="true"
            className="mx-auto size-6 text-muted-foreground"
          />
          <p className="mt-3 text-sm font-medium">Noch keine Nutzungsdaten</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
            {localUsageStats
              ? "Nutze die App wie gewohnt: Öffne Bereiche, wechsle zwischen ihnen oder führe eine Datenbankabfrage aus. Neue Werte erscheinen hier bei der nächsten Aktualisierung."
              : "Aktiviere die lokale Erfassung, um deine Nutzung hier zu sehen. Die Entwickleranalyse kann unabhängig davon ein- oder ausgeschaltet bleiben."}
          </p>
        </div>
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

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, CircleDashedIcon, CircleSlashIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SettingsRow } from "@/features/settings/settings-row";
import { formatRelative } from "@/lib/automation/format";
import { toast } from "@/lib/automation/toast";
import { useNow } from "@/lib/automation/use-now";
import {
  automationBackgroundStatus,
  type BackgroundStatus,
  installAutomationBackground,
  uninstallAutomationBackground,
} from "@/lib/db/automation";

const KEY = ["automation", "background"] as const;

export function SettingsBackgroundSection() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: KEY,
    queryFn: automationBackgroundStatus,
    refetchInterval: 60_000,
  });
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);
  const data = status.data;

  const change = async (action: () => Promise<BackgroundStatus>, done: string) => {
    setBusy(true);
    try {
      client.setQueryData(KEY, await action());
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const Icon = !data?.supported
    ? CircleSlashIcon
    : data.installed
      ? CircleCheckIcon
      : CircleDashedIcon;
  const label = !data
    ? "Status wird geprüft …"
    : !data.supported
      ? "Auf diesem System nicht verfügbar"
      : data.installed
        ? `Eingerichtet (${data.mechanism})`
        : "Nicht eingerichtet";

  return (
    <section aria-labelledby="automation-settings-background" className="space-y-4">
      <div>
        <h2 id="automation-settings-background" className="text-base font-semibold tracking-tight">
          Im Hintergrund ausführen
        </h2>
        <p className="max-w-[65ch] text-xs text-pretty text-muted-foreground">
          l8db startet sich jede Minute kurz unsichtbar und führt fällige Tasks aus, die „Auch im
          Hintergrund ausführen“ aktiviert haben. Läuft die App, übernimmt sie selbst.
        </p>
      </div>
      <div className="space-y-3">
        <SettingsRow
          title="Hintergrunddienst"
          description={
            data?.installed && data.lastTickAt
              ? `Zuletzt aktiv: ${formatRelative(data.lastTickAt, now)}`
              : data?.installed
                ? "Noch nicht aktiv geworden. Der erste Aufruf folgt innerhalb einer Minute."
                : "Ein Eintrag beim Betriebssystem, der l8db minütlich aufruft. Entfernen räumt ihn vollständig ab."
          }
          featureId="automation.background"
        >
          <div className="flex items-center gap-3">
            <span
              className="flex items-center gap-1.5 text-xs"
              data-testid="automation-background-status"
            >
              <Icon
                aria-hidden
                className={
                  data?.installed
                    ? "size-3.5 text-emerald-600 dark:text-emerald-400"
                    : "size-3.5 text-muted-foreground"
                }
              />
              {label}
            </span>
            {data?.supported &&
              (data.installed ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() =>
                    void change(uninstallAutomationBackground, "Hintergrunddienst entfernt")
                  }
                >
                  {busy && <Spinner className="size-3" />}
                  Entfernen
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() =>
                    void change(installAutomationBackground, "Hintergrunddienst eingerichtet")
                  }
                >
                  {busy && <Spinner className="size-3" />}
                  Einrichten
                </Button>
              ))}
          </div>
        </SettingsRow>
        {data && (data.location || data.detail) && (
          <div className="grid gap-1.5 rounded-xl bg-muted/50 px-3.5 py-3 text-xs">
            {data.location && (
              <p className="flex min-w-0 gap-2">
                <span className="shrink-0 text-muted-foreground">Ort</span>
                <span className="truncate font-mono text-[11px]" title={data.location}>
                  {data.location}
                </span>
              </p>
            )}
            <p className="flex min-w-0 gap-2">
              <span className="shrink-0 text-muted-foreground">Programm</span>
              <span className="truncate font-mono text-[11px]" title={data.binary}>
                {data.binary}
              </span>
            </p>
            {data.detail && <p className="text-pretty text-muted-foreground">{data.detail}</p>}
          </div>
        )}
        {status.error && <p className="text-xs text-destructive">{String(status.error)}</p>}
      </div>
    </section>
  );
}

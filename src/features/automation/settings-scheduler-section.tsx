import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import type { AutomationSettings } from "@/lib/db/automation";

interface Props {
  settings: AutomationSettings;
  update: (patch: Partial<AutomationSettings>) => void;
}

function parsePositive(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function SettingsSchedulerSection({ settings, update }: Props) {
  const [parallel, setParallel] = useState(String(settings.maxParallelRuns ?? ""));
  const [days, setDays] = useState(String(settings.defaultRetention?.keepDays ?? ""));
  const [runs, setRuns] = useState(String(settings.defaultRetention?.keepRuns ?? ""));

  useEffect(() => setParallel(String(settings.maxParallelRuns ?? "")), [settings.maxParallelRuns]);
  useEffect(() => {
    setDays(String(settings.defaultRetention?.keepDays ?? ""));
    setRuns(String(settings.defaultRetention?.keepRuns ?? ""));
  }, [settings.defaultRetention]);

  const commitRetention = () => {
    const keepDays = parsePositive(days);
    const keepRuns = parsePositive(runs);
    const next = keepDays || keepRuns ? { keepDays, keepRuns } : null;
    if (JSON.stringify(next) !== JSON.stringify(settings.defaultRetention ?? null))
      update({ defaultRetention: next });
  };

  const browse = async () => {
    const path = await open({ directory: true, multiple: false }).catch(() => null);
    if (typeof path === "string") update({ defaultOutputDir: path });
  };

  return (
    <section aria-labelledby="automation-settings-run" className="space-y-4">
      <div>
        <h2 id="automation-settings-run" className="text-base font-semibold tracking-tight">
          Ausführung
        </h2>
        <p className="text-xs text-muted-foreground">
          Wie l8db geplante Tasks startet, solange die App geöffnet ist.
        </p>
      </div>
      <div className="space-y-3">
        <SettingsRow
          title="Zeitpläne in der App ausführen"
          description="Aus: Tasks laufen nur, wenn du sie selbst startest. Der Hintergrundmodus bleibt davon unberührt."
        >
          <Switch
            checked={settings.schedulerEnabled}
            onCheckedChange={(schedulerEnabled) => update({ schedulerEnabled })}
            aria-label="Zeitpläne in der App ausführen"
          />
        </SettingsRow>
        <SettingsRow
          title="Gleichzeitige Läufe"
          description="Weitere fällige Tasks warten, bis ein Lauf frei wird. Leer lassen für keine Begrenzung."
        >
          <Input
            type="number"
            min={1}
            max={32}
            inputMode="numeric"
            placeholder="Unbegrenzt"
            aria-label="Gleichzeitige Läufe"
            value={parallel}
            onChange={(event) => setParallel(event.target.value)}
            onBlur={() => {
              const next = parsePositive(parallel);
              if (next !== (settings.maxParallelRuns ?? null)) update({ maxParallelRuns: next });
            }}
            className="h-8 w-28 text-xs"
          />
        </SettingsRow>
        <SettingsRow
          title="Standard-Ausgabeordner"
          description="Ziel für Exporte und Backups, wenn ein Schritt nur einen Dateinamen angibt. Platzhalter: ${output_dir}."
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {settings.defaultOutputDir ? (
              <>
                <span
                  className="max-w-56 truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px]"
                  title={settings.defaultOutputDir}
                >
                  {settings.defaultOutputDir}
                </span>
                <IconButton
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Ausgabeordner zurücksetzen"
                  onClick={() => update({ defaultOutputDir: null })}
                >
                  <XIcon />
                </IconButton>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Dokumente/l8db</span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => void browse()}
            >
              <FolderOpenIcon />
              Durchsuchen …
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          title="Verlauf aufbewahren"
          description="Gilt für Tasks ohne eigene Regel. Ältere Läufe werden mit Logs gelöscht; Ausgabedateien bleiben."
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="∞"
              aria-label="Tage aufbewahren"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              onBlur={commitRetention}
              className="h-8 w-20 text-xs"
            />
            Tage
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="∞"
              aria-label="Läufe je Task aufbewahren"
              value={runs}
              onChange={(event) => setRuns(event.target.value)}
              onBlur={commitRetention}
              className="h-8 w-20 text-xs"
            />
            Läufe je Task
          </div>
        </SettingsRow>
        <SettingsRow
          title="Systembenachrichtigung bei Fehlern"
          description="Meldet fehlgeschlagene geplante Läufe auch ohne eigene Benachrichtigungsregel. Manuelle Läufe siehst du direkt."
        >
          <Switch
            checked={settings.notifyNativeOnFailure}
            onCheckedChange={(notifyNativeOnFailure) => update({ notifyNativeOnFailure })}
            aria-label="Systembenachrichtigung bei Fehlern"
          />
        </SettingsRow>
      </div>
    </section>
  );
}

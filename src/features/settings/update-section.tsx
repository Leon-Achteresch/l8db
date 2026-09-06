import type { Update } from "@tauri-apps/plugin-updater";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore } from "@/lib/settings";
import {
  checkForUpdates,
  getAppVersion,
  getPendingUpdate,
  installUpdateAndRelaunch,
  setPendingUpdate,
} from "@/lib/updater";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number }
  | { kind: "failed"; message: string };

export function UpdateSection() {
  const [status, setStatus] = useState<Status>(() => {
    const pending = getPendingUpdate();
    return pending ? { kind: "available", update: pending } : { kind: "idle" };
  });
  const [version, setVersion] = useState<string | null>(null);
  const { autoUpdateCheck, autoUpdateInstall, setAutoUpdateCheck, setAutoUpdateInstall } =
    useSettingsStore();

  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCheck() {
    setStatus({ kind: "checking" });
    try {
      const update = await checkForUpdates();
      setStatus(update ? { kind: "available", update } : { kind: "current" });
    } catch {
      setStatus({ kind: "failed", message: "Update-Prüfung fehlgeschlagen" });
    }
  }

  async function onInstall(update: Update) {
    setStatus({ kind: "downloading", percent: 0 });
    try {
      await installUpdateAndRelaunch(update, (percent) =>
        setStatus({ kind: "downloading", percent }),
      );
    } catch {
      setStatus({ kind: "failed", message: "Update konnte nicht installiert werden" });
    }
  }

  function onDismiss() {
    setPendingUpdate(null);
    setStatus({ kind: "current" });
  }

  const available = status.kind === "available" ? status.update : null;

  return (
    <div className="space-y-3">
      <SettingsRow
        title="Installierte Version"
        description={version ? `l8db ${version}` : "Version wird ermittelt …"}
      >
        <Button
          variant="outline"
          onClick={onCheck}
          disabled={status.kind === "checking" || status.kind === "downloading"}
        >
          <RefreshCw className={status.kind === "checking" ? "size-4 animate-spin" : "size-4"} />
          <span>{status.kind === "checking" ? "Prüfe …" : "Nach Updates suchen"}</span>
        </Button>
      </SettingsRow>
      <SettingsRow
        title="Automatisch nach Updates suchen"
        description="Beim Start der App im Hintergrund nach neuen Versionen suchen."
      >
        <Switch
          checked={autoUpdateCheck}
          onCheckedChange={setAutoUpdateCheck}
          aria-label="Automatisch nach Updates suchen"
        />
      </SettingsRow>
      <SettingsRow
        title="Updates automatisch installieren"
        description="Gefundene Updates ohne Rückfrage installieren und neu starten."
      >
        <Switch
          checked={autoUpdateInstall}
          disabled={!autoUpdateCheck}
          onCheckedChange={setAutoUpdateInstall}
          aria-label="Updates automatisch installieren"
        />
      </SettingsRow>
      {status.kind === "current" ? (
        <SettingsRow title="Updates" description="Du nutzt die aktuelle Version.">
          <span className="text-xs text-muted-foreground">Aktuell</span>
        </SettingsRow>
      ) : null}
      {status.kind === "failed" ? (
        <SettingsRow title="Updates" description={status.message}>
          <Button variant="outline" onClick={onCheck}>
            Erneut versuchen
          </Button>
        </SettingsRow>
      ) : null}
      {available ? (
        <div className="rounded-2xl border border-border/80 bg-card px-4 py-3.5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Version {available.version} ist verfügbar</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {available.date
                  ? `Veröffentlicht am ${new Date(available.date).toLocaleDateString("de-DE")}`
                  : "Eine neue Version steht bereit."}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={onDismiss}>
                Später
              </Button>
              <Button onClick={() => onInstall(available)}>Installieren</Button>
            </div>
          </div>
          {available.body ? (
            <p className="mt-3 max-h-32 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {available.body}
            </p>
          ) : null}
        </div>
      ) : null}
      {status.kind === "downloading" ? (
        <div className="rounded-2xl border border-border/80 bg-card px-4 py-3.5 shadow-sm">
          <p className="text-sm font-semibold">Update wird installiert … {status.percent} %</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Die App startet nach der Installation automatisch neu.
          </p>
          <Progress value={status.percent} className="mt-3" />
        </div>
      ) : null}
    </div>
  );
}

import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore } from "@/lib/settings";
import { checkForUpdates, getAppVersion, getPendingUpdate, presentUpdate } from "@/lib/updater";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available" }
  | { kind: "failed"; message: string };

export function UpdateSection() {
  const [status, setStatus] = useState<Status>(() =>
    getPendingUpdate() ? { kind: "available" } : { kind: "idle" },
  );
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
      if (update) {
        setStatus({ kind: "available" });
        presentUpdate(update);
      } else {
        setStatus({ kind: "current" });
      }
    } catch {
      setStatus({ kind: "failed", message: "Update-Prüfung fehlgeschlagen" });
    }
  }

  const pending = getPendingUpdate();

  return (
    <motion.div layout transition={{ layout: SPRING_LAYOUT }} className="space-y-3">
      <SettingsRow
        title="Installierte Version"
        description={version ? `l8db ${version}` : "Version wird ermittelt …"}
      >
        <Button variant="outline" onClick={() => void onCheck()} disabled={status.kind === "checking"}>
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
      <SettingsRow title="Release Notes" description="Änderungen aller veröffentlichten Versionen.">
        <Button variant="outline" asChild>
          <Link to="/release-notes">Anzeigen</Link>
        </Button>
      </SettingsRow>
      {status.kind === "current" ? (
        <SettingsRow title="Updates" description="Du nutzt die aktuelle Version.">
          <span className="text-xs text-muted-foreground">Aktuell</span>
        </SettingsRow>
      ) : null}
      {status.kind === "failed" ? (
        <SettingsRow title="Updates" description={status.message}>
          <Button variant="outline" onClick={() => void onCheck()}>
            Erneut versuchen
          </Button>
        </SettingsRow>
      ) : null}
      {status.kind === "available" && pending ? (
        <SettingsRow title="Update verfügbar" description={`Version ${pending.version} steht bereit.`}>
          <Button onClick={() => presentUpdate(pending)}>Anzeigen</Button>
        </SettingsRow>
      ) : null}
    </motion.div>
  );
}

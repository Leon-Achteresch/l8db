import type { Update } from "@tauri-apps/plugin-updater";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/features/settings/settings-row";
import { checkForUpdates, installUpdateAndRelaunch } from "@/lib/updater";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number }
  | { kind: "failed"; message: string };

export function UpdateSection() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onCheck() {
    setStatus({ kind: "checking" });
    const update = await checkForUpdates();
    if (!update) {
      setStatus({ kind: "current" });
      return;
    }
    setStatus({ kind: "available", update });
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

  const description =
    status.kind === "available"
      ? `Version ${status.update.version} ist verfügbar`
      : status.kind === "current"
        ? "Du nutzt die aktuelle Version"
        : status.kind === "downloading"
          ? `Update wird installiert … ${status.percent} %`
          : status.kind === "failed"
            ? status.message
            : "Automatisch über GitHub Releases";

  return (
    <SettingsRow title="Updates" description={description}>
      {status.kind === "available" ? (
        <Button onClick={() => onInstall(status.update)}>Installieren</Button>
      ) : (
        <Button
          variant="outline"
          onClick={onCheck}
          disabled={status.kind === "checking" || status.kind === "downloading"}
        >
          <RefreshCw className={status.kind === "checking" ? "size-4 animate-spin" : "size-4"} />
          <span>{status.kind === "checking" ? "Prüfe …" : "Nach Updates suchen"}</span>
        </Button>
      )}
    </SettingsRow>
  );
}

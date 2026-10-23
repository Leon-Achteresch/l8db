import { ClipboardCopyIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/features/settings/settings-row";
import { copyText } from "@/lib/clipboard";
import { useConnectionsStore } from "@/lib/connections";
import { useTeamStore } from "@/lib/team/store";
import { syncTeam, TEAM_HUB, teamErrorText } from "@/lib/team/sync";

export function TeamPanel() {
  const { path, exists, lastSyncAt, lastError, warnings } = useTeamStore();
  const count = useConnectionsStore(
    (state) => state.connections.filter((connection) => connection.team?.hub === TEAM_HUB).length,
  );
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setBusy(true);
    try {
      const result = await syncTeam();
      toast.success(
        `Team-Verbindungen neu geladen: ${result.added} neu, ${result.updated} geändert, ${result.removed.length} entfernt`,
      );
    } catch (error) {
      toast.error(teamErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow settingId="team" featureId="settings.general.team" stacked>
      <div className="space-y-2 text-xs">
        <p>
          l8db übernimmt automatisch alle Verbindungen aus{" "}
          <code className="break-all rounded bg-muted px-1">
            {path ?? "%APPDATA%\\.l8db\\connections.json bzw. ~/.l8db/connections.json"}
          </code>
          .{" "}
          {exists
            ? `${count} Team-Verbindungen, zuletzt gelesen ${lastSyncAt ? new Date(lastSyncAt).toLocaleString("de-DE") : "nie"}.`
            : "Die Datei existiert auf diesem Rechner nicht."}
        </p>
        <p className="text-muted-foreground">
          Die Datei legt deine IT ab, Passwörter stehen nicht darin. Beim ersten Verbinden fragt
          l8db nach Benutzer und Passwort.
        </p>
        {lastError && (
          <p role="alert" className="flex gap-1.5 text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{lastError}</span>
          </p>
        )}
        {warnings.length > 0 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Hinweise für die IT ({warnings.length})</summary>
            <ul aria-label="Hinweise für die IT" className="mt-1 space-y-1">
              {warnings.map((warning) => (
                <li key={warning} className="flex gap-1.5">
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>
            <RefreshCwIcon className="size-3.5" />
            <span>{busy ? "Lese…" : "Neu laden"}</span>
          </Button>
          {path && (
            <Button size="sm" variant="ghost" onClick={() => void copyText(path, "Pfad kopiert")}>
              <ClipboardCopyIcon className="size-3.5" />
              <span>Pfad kopieren</span>
            </Button>
          )}
        </div>
      </div>
    </SettingsRow>
  );
}

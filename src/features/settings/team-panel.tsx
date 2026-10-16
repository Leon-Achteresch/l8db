import { LogInIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/features/settings/settings-row";
import { useConnectionsStore } from "@/lib/connections";
import { teamCancelLogin } from "@/lib/db/team";
import { useTeamStore } from "@/lib/team/store";
import { isLoginCancelled, loginTeam, logoutTeam, syncTeam, teamErrorText } from "@/lib/team/sync";

function summary(result: { added: number; updated: number; removed: string[] } | null): string {
  if (!result) return "Team-Verbindungen abgeglichen";
  return `Team-Verbindungen abgeglichen: ${result.added} neu, ${result.updated} geändert, ${result.removed.length} entfernt`;
}

export function TeamPanel() {
  const { hubUrl, user, name, lastSyncAt, lastError, managedHub } = useTeamStore();
  const count = useConnectionsStore(
    (state) => state.connections.filter((connection) => connection.team?.hub === hubUrl).length,
  );
  const [typed, setAddress] = useState(hubUrl);
  const address = managedHub ?? typed;
  const [busy, setBusy] = useState<"login" | "sync" | null>(null);

  const run = async (kind: "login" | "sync", work: () => ReturnType<typeof syncTeam>) => {
    setBusy(kind);
    try {
      toast.success(summary(await work()));
    } catch (error) {
      if (!isLoginCancelled(error)) toast.error(teamErrorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsRow settingId="team" featureId="settings.general.team" stacked>
      {user ? (
        <div className="space-y-2 text-xs">
          <p>
            Angemeldet als <span className="font-medium">{user.name}</span> ({user.email})
            {name ? ` bei ${name}` : ""}. {count} Team-Verbindungen, zuletzt abgeglichen{" "}
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString("de-DE") : "nie"}.
          </p>
          <p className="text-muted-foreground">
            Rechte vergibt die Datenbank: Beim ersten Verbinden fragt l8db nach deinem
            Datenbank-Benutzer.
          </p>
          {lastError && <p className="text-destructive">{lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => run("sync", syncTeam)}
            >
              <RefreshCwIcon className="size-3.5" />
              <span>{busy === "sync" ? "Gleiche ab…" : "Jetzt abgleichen"}</span>
            </Button>
            {busy === "login" ? (
              <Button size="sm" variant="outline" onClick={() => void teamCancelLogin()}>
                Warte auf Browser… Abbrechen
              </Button>
            ) : (
              lastError && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run("login", () => loginTeam(hubUrl))}
                >
                  <LogInIcon className="size-3.5" />
                  <span>Erneut anmelden</span>
                </Button>
              )
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void logoutTeam()}
            >
              <LogOutIcon className="size-3.5" />
              <span>Abmelden</span>
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run("login", () => loginTeam(address));
          }}
        >
          <Input
            type="url"
            required
            aria-label="Team-Hub-Adresse"
            placeholder="https://l8db.firma.de"
            value={address}
            disabled={busy !== null}
            readOnly={managedHub !== null}
            title={managedHub ? "Von deiner Organisation vorgegeben" : undefined}
            onChange={(event) => setAddress(event.target.value)}
            className="h-8 w-64 text-xs"
          />
          {busy === "login" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void teamCancelLogin()}
            >
              Warte auf Browser… Abbrechen
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={busy !== null || !address.trim()}>
              <LogInIcon className="size-3.5" />
              <span>Mit Firmenkonto anmelden</span>
            </Button>
          )}
        </form>
      )}
    </SettingsRow>
  );
}

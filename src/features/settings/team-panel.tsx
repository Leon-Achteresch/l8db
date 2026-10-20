import { useNavigate } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  LogInIcon,
  LogOutIcon,
  RefreshCwIcon,
  RocketIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/features/settings/settings-row";
import { copyText } from "@/lib/clipboard";
import { useConnectionsStore } from "@/lib/connections";
import { teamCancelLogin, teamMicrosoftAvailable } from "@/lib/db/team";
import { useTeamStore } from "@/lib/team/store";
import {
  isLoginCancelled,
  loginTeam,
  logoutTeam,
  MICROSOFT_HUB,
  syncTeam,
  teamErrorText,
} from "@/lib/team/sync";

function summary(result: { added: number; updated: number; removed: string[] } | null): string {
  if (!result) return "Team-Verbindungen abgeglichen";
  return `Team-Verbindungen abgeglichen: ${result.added} neu, ${result.updated} geändert, ${result.removed.length} entfernt`;
}

export function TeamPanel() {
  const team = useTeamStore();
  const { hubUrl, user, name, url, lastSyncAt, lastError, managedHub, warnings, policyError } =
    team;
  const count = useConnectionsStore(
    (state) => state.connections.filter((connection) => connection.team?.hub === hubUrl).length,
  );
  const [typed, setAddress] = useState(hubUrl === MICROSOFT_HUB ? "" : hubUrl);
  const [busy, setBusy] = useState<"login" | "sync" | null>(null);
  const [microsoft, setMicrosoft] = useState(false);
  const microsoftUser = hubUrl === MICROSOFT_HUB;
  const ownHubManaged = managedHub !== null && managedHub !== MICROSOFT_HUB;
  const address = ownHubManaged ? managedHub : typed;
  const navigate = useNavigate();
  const openSetup = () => void navigate({ to: "/team-setup" });

  useEffect(() => {
    void teamMicrosoftAvailable()
      .then(setMicrosoft)
      .catch(() => setMicrosoft(false));
  }, []);

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

  const diagnose = async () =>
    copyText(
      JSON.stringify(
        {
          l8db: await getVersion().catch(() => "unbekannt"),
          source: microsoftUser ? "microsoft365" : hubUrl || null,
          managed: managedHub,
          policyError,
          allowedHosts: team.allowedHosts,
          user: user?.email ?? null,
          site: name,
          siteUrl: url,
          connections: count,
          lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
          lastError,
          warnings,
        },
        null,
        2,
      ),
      "Diagnose kopiert",
    );

  const loginForm = (
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
        readOnly={ownHubManaged}
        title={ownHubManaged ? "Von deiner Organisation vorgegeben" : undefined}
        onChange={(event) => setAddress(event.target.value)}
        className="h-8 w-64 text-xs"
      />
      <Button
        type="submit"
        size="sm"
        variant={ownHubManaged ? "default" : "outline"}
        disabled={!address.trim()}
      >
        <LogInIcon className="size-3.5" />
        <span>Beim Team-Hub anmelden</span>
      </Button>
    </form>
  );

  return (
    <SettingsRow settingId="team" featureId="settings.general.team" stacked>
      {policyError ? (
        <div className="space-y-2 text-xs">
          <p role="alert" className="flex gap-1.5 text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Die Richtlinie deiner IT für Team-Verbindungen ist fehlerhaft. Bis sie korrigiert ist,
              gleicht l8db keine Team-Verbindungen ab. Details: {policyError}
            </span>
          </p>
          <Button size="sm" variant="ghost" onClick={() => void diagnose()}>
            <ClipboardCopyIcon className="size-3.5" />
            <span>Diagnose kopieren</span>
          </Button>
        </div>
      ) : user ? (
        <div className="space-y-2 text-xs">
          <p>
            Angemeldet als <span className="font-medium">{user.name}</span> ({user.email}) bei{" "}
            {name ?? (microsoftUser ? "Microsoft 365" : hubUrl)}. {count} Team-Verbindungen, zuletzt
            abgeglichen {lastSyncAt ? new Date(lastSyncAt).toLocaleString("de-DE") : "nie"}.
          </p>
          {count === 0 && !lastError && (
            <p>
              Für dich ist noch nichts freigegeben. Wende dich an deine IT, wenn du Verbindungen
              erwartest.
            </p>
          )}
          <p className="text-muted-foreground">
            Was du in einer Datenbank darfst, regelt dein Datenbank-Benutzer. Beim ersten Verbinden
            fragt l8db danach.
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
            {url && (
              <Button size="sm" variant="ghost" onClick={() => void openUrl(url)}>
                <ExternalLinkIcon className="size-3.5" />
                <span>In SharePoint öffnen</span>
              </Button>
            )}
            {microsoftUser && (
              <Button size="sm" variant="ghost" onClick={openSetup}>
                <RocketIcon className="size-3.5" />
                <span>Einrichtung für die IT</span>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void diagnose()}>
              <ClipboardCopyIcon className="size-3.5" />
              <span>Diagnose kopieren</span>
            </Button>
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
      ) : busy === "login" ? (
        <Button size="sm" variant="outline" onClick={() => void teamCancelLogin()}>
          Warte auf Browser… Abbrechen
        </Button>
      ) : ownHubManaged ? (
        loginForm
      ) : (
        <div className="space-y-3 text-xs">
          {microsoft ? (
            <Button size="sm" onClick={() => run("login", () => loginTeam(MICROSOFT_HUB))}>
              <LogInIcon className="size-3.5" />
              <span>Mit Microsoft anmelden</span>
            </Button>
          ) : null}
          {managedHub !== MICROSOFT_HUB && (
            <details open={!microsoft}>
              <summary className="cursor-pointer text-muted-foreground">
                Eigenen Team-Hub verwenden
              </summary>
              <div className="mt-2">{loginForm}</div>
            </details>
          )}
          <div className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">Für die IT</p>
            <p className="text-muted-foreground">
              Microsoft 365 einmalig für das ganze Unternehmen einrichten: Schritt für Schritt, mit
              Erklärvideos und Beispieldatei zum Verteilen.
            </p>
            <Button size="sm" variant="outline" onClick={openSetup}>
              <RocketIcon className="size-3.5" />
              <span>Einrichtung starten</span>
            </Button>
          </div>
        </div>
      )}
    </SettingsRow>
  );
}

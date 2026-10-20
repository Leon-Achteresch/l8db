import { useNavigate } from "@tanstack/react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ExternalLinkIcon,
  LogInIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
import { teamCancelLogin, teamMicrosoftAvailable } from "@/lib/db/team";
import {
  hostPatterns,
  policyJson,
  policyScript,
  TEAM_EXAMPLE_FILE,
  TEAM_EXAMPLE_JSON,
  TEAM_SITE_PLACEHOLDER,
  validHostPattern,
  validSiteUrl,
} from "@/lib/team/setup";
import { useTeamStore } from "@/lib/team/store";
import { isLoginCancelled, loginTeam, MICROSOFT_HUB, teamErrorText } from "@/lib/team/sync";
import { cn } from "@/lib/utils";
import { TeamSetupCode } from "./team-setup-code";
import { TEAM_SETUP_SCENES } from "./team-setup-scenes";
import { TeamSetupVideo } from "./team-setup-video";

const DOCS_URL = "https://github.com/Leon-Achteresch/l8db/blob/main/docs/team-hub.md";

const STEPS = [
  {
    id: "consent",
    label: "l8db freigeben",
    description: "Zustimmung in Microsoft Entra",
    title: "l8db für die Organisation freigeben",
    points: [
      "Einmalig für alle: Danach sieht niemand im Unternehmen mehr einen Zustimmungsdialog.",
      "Nötig ist die Rolle Globale Administration oder Cloudanwendungsadministration.",
      "l8db fragt nur delegierte Rechte an (Anmelden, Profil, Sites.Read.All) und liest damit ausschließlich die Website l8db, und nur, was die Person dort ohnehin sehen darf.",
      "Kein Secret und kein Server: l8db meldet sich direkt bei Microsoft an.",
    ],
    guide: {
      label: "Microsoft: Administratorzustimmung erteilen",
      url: "https://learn.microsoft.com/de-de/entra/identity/enterprise-apps/grant-admin-consent",
    },
  },
  {
    id: "site",
    label: "Website anlegen",
    description: "SharePoint-Kommunikationswebsite",
    title: "SharePoint-Website „l8db“ anlegen",
    points: [
      "Als Kommunikationswebsite anlegen, nicht als Teamwebsite oder Microsoft-Team: Dort dürfen alle Mitglieder Dateien bearbeiten.",
      "Besitzer ist nur die IT. Am besten sofort anlegen, damit niemand anderes den Namen belegt.",
      "In der Bibliothek „Dokumente“ pro Zielgruppe einen Ordner anlegen, zum Beispiel Alle, Vertrieb, Finanzen.",
    ],
    guide: {
      label: "Microsoft: Kommunikationswebsite erstellen (mit Video)",
      url: "https://support.microsoft.com/de-de/office/create-a-team-or-communication-site-551e190a-8fbe-47ae-a88a-798b443c46b1",
    },
  },
  {
    id: "access",
    label: "Zugriff vergeben",
    description: "Leserechte für Entra-Gruppen",
    title: "Ordner für Gruppen freigeben",
    points: [
      "Jeden Ordner über „Zugriff verwalten“ für die passende Entra-Gruppe freigeben, mit „Kann anzeigen“.",
      "Schreibrechte nur für die IT: Wer schreiben darf, bestimmt, wohin sich alle Leser verbinden.",
      "Wer in mehreren Gruppen ist, sieht alle passenden Verbindungen. Änderungen an verschachtelten Gruppen können bis zu einer Stunde dauern.",
      "Ausnahmen („Vertrieb außer Max“) kennt SharePoint nicht. Dafür eine eigene Gruppe anlegen.",
    ],
    guide: {
      label: "Microsoft: SharePoint-Dateien oder -Ordner freigeben",
      url: "https://support.microsoft.com/de-de/office/share-sharepoint-files-or-folders-1fe37332-0f9a-4719-970e-d2578da4941c",
    },
  },
  {
    id: "connections",
    label: "Verbindungen ablegen",
    description: "JSON-Datei oder direkt aus l8db",
    title: "Verbindungen in die Ordner legen",
    points: [
      "Am einfachsten aus l8db: Verbindung anlegen, testen und im Menü der Verbindung „Für Team freigeben…“ wählen. l8db lädt sie ohne Benutzer und Passwort hoch.",
      "Oder die Beispieldatei herunterladen, anpassen und in den Ordner hochladen. Jede .json-Datei wird gelesen (bis 4 Ordnerebenen, je Datei höchstens 256 KB).",
      "Pflicht sind id, name, kind und connectionString ohne Passwort oder Token. Die id stabil halten, sonst gehen gespeicherte Passwörter verloren.",
      "Optional: environment, readOnly, tags, color, sslMode, schemas, ssh, proxy. Erlaubte Typen: postgres, mysql, mssql, oracle, clickhouse, mongodb, redis, cassandra, elasticsearch, influxdb, snowflake.",
    ],
    guide: {
      label: "Microsoft: Dateien in eine Bibliothek hochladen",
      url: "https://support.microsoft.com/de-de/office/upload-files-and-folders-to-a-library-da549fb1-1fcb-4167-87d0-4693e93cb7a0",
    },
  },
  {
    id: "policy",
    label: "Richtlinie verteilen",
    description: "Empfohlen, per Intune oder GPO",
    title: "Website und Hosts per Richtlinie festlegen",
    points: [
      "Empfohlen: Erst damit kann weder eine fremde Website gleichen Namens noch jemand mit Schreibrecht Nutzer auf einen anderen Server lotsen.",
      "Mit Richtlinie bietet l8db die Anmeldung beim Start automatisch an, auch schon vor dem Onboarding.",
      "Windows liest HKLM\\SOFTWARE\\Policies\\l8db. Das Skript im Systemkontext verteilen, als Intune-Plattformskript oder per Gruppenrichtlinie mit der ADMX-Vorlage.",
    ],
    guide: {
      label: "Microsoft: PowerShell-Skripts in Intune",
      url: "https://learn.microsoft.com/de-de/intune/intune-service/apps/powershell-scripts",
    },
  },
  {
    id: "test",
    label: "Testen",
    description: "Anmelden und prüfen",
    title: "Anmeldung testen",
    points: [
      "Auf einem Rechner mit Richtlinie l8db starten: Die Anmeldung erscheint automatisch. Sonst unter Einstellungen › Team-Verbindungen „Mit Microsoft anmelden“.",
      "Auf Windows-Rechnern in Entra erscheint der Browser nur kurz, ohne Passwortabfrage.",
      "Beim ersten Verbinden fragt l8db nach Datenbank-Benutzer und Passwort. Was jemand in der Datenbank darf, regelt allein der Datenbank-Benutzer.",
      "Bei Problemen unter Team-Verbindungen „Diagnose kopieren“ wählen. Fehlermeldungen nennen den AADSTS-Code.",
    ],
    guide: { label: "Vollständige Anleitung für die IT", url: DOCS_URL },
  },
] as const;

export function TeamSetupView() {
  const navigate = useNavigate();
  const team = useTeamStore();
  const microsoftUser = team.hubUrl === MICROSOFT_HUB && team.user !== null;
  const ownHub =
    (team.managedHub !== null && team.managedHub !== MICROSOFT_HUB) ||
    (team.user !== null && team.hubUrl !== MICROSOFT_HUB);
  const count = useConnectionsStore(
    (state) =>
      state.connections.filter((connection) => connection.team?.hub === MICROSOFT_HUB).length,
  );
  const [current, setCurrent] = useState(0);
  const [microsoft, setMicrosoft] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [siteUrl, setSiteUrl] = useState(microsoftUser ? (team.url ?? "") : "");
  const [hostsText, setHostsText] = useState(team.allowedHosts.join("; "));
  const hosts = hostPatterns(hostsText);
  const invalidHost = hosts.find((host) => !validHostPattern(host));
  const siteInvalid = Boolean(siteUrl.trim()) && !validSiteUrl(siteUrl);
  const step = STEPS[current];
  const last = current === STEPS.length - 1;

  useEffect(() => {
    void teamMicrosoftAvailable()
      .then(setMicrosoft)
      .catch(() => setMicrosoft(false));
  }, []);

  const back = () =>
    void navigate({ to: "/settings", search: { tab: "general", setting: "team" } });

  const login = async (admin: boolean) => {
    setBusy(true);
    try {
      await loginTeam(MICROSOFT_HUB, admin);
      toast.success(
        admin ? "l8db ist für die Organisation freigegeben" : "Mit Microsoft angemeldet",
      );
    } catch (error) {
      if (!isLoginCancelled(error)) toast.error(teamErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const loginButton = (admin: boolean) =>
    busy ? (
      <Button size="sm" variant="outline" onClick={() => void teamCancelLogin()}>
        Warte auf Browser… Abbrechen
      </Button>
    ) : (
      <Button size="sm" onClick={() => void login(admin)}>
        {admin ? <ShieldCheckIcon className="size-3.5" /> : <LogInIcon className="size-3.5" />}
        <span>{admin ? "Für die Organisation freigeben" : "Mit Microsoft anmelden"}</span>
      </Button>
    );

  const accountStatus = microsoftUser ? (
    <p role="status" className="flex gap-1.5 text-xs">
      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span>
        Angemeldet als <span className="font-medium">{team.user?.name}</span> ({team.user?.email}).{" "}
        {count} Team-Verbindungen.
      </span>
    </p>
  ) : ownHub ? (
    <p className="text-xs text-muted-foreground">
      Du nutzt einen eigenen Team-Hub, oder deine Organisation gibt einen vor. Die
      Microsoft-Anmeldung ist hier deshalb ausgeschaltet.
    </p>
  ) : null;

  const extra: Record<(typeof STEPS)[number]["id"], () => ReactNode> = {
    consent: () =>
      microsoft === false ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
        >
          <p className="flex gap-1.5">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <span>
              Diese l8db-Version bringt keine Microsoft-App mit. Registriert eine eigene App und
              setzt MicrosoftClientId und MicrosoftTenant per Richtlinie. Danach l8db neu starten.
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openUrl(`${DOCS_URL}#eigene-app-registrierung-optional`)}
          >
            <ExternalLinkIcon className="size-3.5" />
            <span>Anleitung: eigene App-Registrierung</span>
          </Button>
        </div>
      ) : microsoft ? (
        (accountStatus ?? loginButton(true))
      ) : null,
    site: () => (
      <div className="space-y-1.5">
        <label htmlFor="team-setup-site" className="block text-xs font-medium">
          Adresse der Website
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="team-setup-site"
            type="url"
            value={siteUrl}
            placeholder={TEAM_SITE_PLACEHOLDER}
            aria-invalid={siteInvalid}
            aria-describedby="team-setup-site-hint"
            onChange={(event) => setSiteUrl(event.target.value)}
            className="h-8 min-w-64 flex-1 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!validSiteUrl(siteUrl)}
            onClick={() => void openUrl(siteUrl.trim())}
          >
            <ExternalLinkIcon className="size-3.5" />
            <span>Website öffnen</span>
          </Button>
        </div>
        <p
          id="team-setup-site-hint"
          className={cn("text-[11px]", siteInvalid ? "text-destructive" : "text-muted-foreground")}
        >
          {siteInvalid
            ? `Erwartet wird eine https-Adresse wie ${TEAM_SITE_PLACEHOLDER}.`
            : "Wird in Schritt 5 in die Richtlinie übernommen."}
        </p>
      </div>
    ),
    access: () => null,
    connections: () => (
      <TeamSetupCode
        title="Beispiel mit drei Verbindungen"
        file={TEAM_EXAMPLE_FILE}
        text={TEAM_EXAMPLE_JSON}
      />
    ),
    policy: () => (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="team-setup-hosts" className="block text-xs font-medium">
            Erlaubte Datenbank-Hosts
          </label>
          <Input
            id="team-setup-hosts"
            value={hostsText}
            placeholder="*.firma.intern; db01"
            aria-invalid={Boolean(invalidHost)}
            aria-describedby="team-setup-hosts-hint"
            onChange={(event) => setHostsText(event.target.value)}
            className="h-8 text-xs"
          />
          <p
            id="team-setup-hosts-hint"
            className={cn(
              "text-[11px]",
              invalidHost ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {invalidHost
              ? `„${invalidHost}“ ist kein gültiger Host und fehlt in der Richtlinie. Erlaubt sind Namen wie db01 oder *.firma.intern.`
              : "Eigene Servernamen eintragen, keine fremden Cloud-Domains wie *.database.windows.net."}
          </p>
        </div>
        {validSiteUrl(siteUrl) ? null : (
          <p className="flex gap-1.5 text-xs">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <span>
              Ohne gültige Adresse der Website aus Schritt 2 legt die Richtlinie keine Website fest.
              l8db nimmt dann die erste Website namens l8db.
            </span>
          </p>
        )}
        <TeamSetupCode
          title="Windows: Intune-Plattformskript oder Anmeldeskript"
          file="l8db-richtlinie.ps1"
          text={policyScript(siteUrl, hosts)}
        />
        <TeamSetupCode
          title="macOS: /Library/Application Support/l8db/ · Linux: /etc/l8db/"
          file="hub.json"
          text={policyJson(siteUrl, hosts)}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void openUrl(
              "https://github.com/Leon-Achteresch/l8db/tree/main/packaging/windows-policy",
            )
          }
        >
          <ExternalLinkIcon className="size-3.5" />
          <span>ADMX-Vorlage für Gruppenrichtlinien</span>
        </Button>
      </div>
    ),
    test: () => (microsoft ? (accountStatus ?? loginButton(false)) : null),
  };

  return (
    <main className="workspace-canvas h-full w-full min-w-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <Button size="sm" variant="ghost" className="-ml-2" onClick={back}>
          <ArrowLeftIcon className="size-3.5" />
          <span>Einstellungen</span>
        </Button>
        <header className="mt-2 mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Team-Verbindungen mit Microsoft 365 einrichten
          </h1>
          <p className="mt-1 max-w-[70ch] text-xs text-muted-foreground">
            Für die IT, einmalig etwa 15 Minuten. Danach erhalten alle im Unternehmen ihre
            Datenbankverbindungen automatisch. Kein Server, keine Secrets, keine Passwörter in den
            Freigaben: Wer was sieht, regelt die SharePoint-Freigabe.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Einrichtungsschritte">
            <ol className="sticky top-8 space-y-1">
              {STEPS.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={index === current ? "step" : undefined}
                    onClick={() => setCurrent(index)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
                      index === current && "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums",
                        index < current && "border-primary bg-primary text-primary-foreground",
                        index === current && "border-primary text-primary",
                        index > current && "text-muted-foreground",
                      )}
                    >
                      {index < current ? <CheckIcon className="size-3.5" /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-sm",
                          index === current ? "font-medium" : "text-muted-foreground",
                        )}
                      >
                        {item.label}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <section aria-labelledby="team-setup-step" className="min-w-0">
            <p className="text-xs text-muted-foreground">
              Schritt {current + 1} von {STEPS.length}
            </p>
            <h2 id="team-setup-step" className="text-lg font-semibold">
              {step.title}
            </h2>
            <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
              <div className="min-w-0 space-y-4">
                <ul className="list-disc space-y-1.5 pl-4 text-sm">
                  {step.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                {extra[step.id]()}
                <Button
                  size="sm"
                  variant="ghost"
                  className="-ml-2 h-auto whitespace-normal text-left"
                  onClick={() => void openUrl(step.guide.url)}
                >
                  <ExternalLinkIcon className="size-3.5" />
                  <span>{step.guide.label}</span>
                </Button>
              </div>
              <TeamSetupVideo
                key={step.id}
                title={step.title}
                scenes={TEAM_SETUP_SCENES[step.id]}
              />
            </div>
            <footer className="mt-8 flex flex-wrap justify-between gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={current === 0}
                onClick={() => setCurrent(current - 1)}
              >
                <ArrowLeftIcon className="size-3.5" />
                <span>Zurück</span>
              </Button>
              {last ? (
                <Button size="sm" onClick={back}>
                  <CheckIcon className="size-3.5" />
                  <span>Fertig</span>
                </Button>
              ) : (
                <Button size="sm" onClick={() => setCurrent(current + 1)}>
                  <span>Weiter: {STEPS[current + 1].label}</span>
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              )}
            </footer>
          </section>
        </div>
      </div>
    </main>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  appwriteConnect,
  convexConnect,
  convexConnectSelfHosted,
  firebaseConnect,
  pocketbaseConnect,
  supabaseConnect,
  supabaseConnectSelfHosted,
} from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { BaasProvider } from "./baas-providers";

type Field = { key: string; label: string; secret?: boolean; optional?: boolean };
type Guide = { steps: string[]; link: { label: string; url: string } };

const SELF_HOSTED: Partial<Record<BaasProvider, { label: string; fields: Field[]; guide: Guide }>> =
  {
    supabase: {
      label: "Projekt-URL & Key",
      fields: [
        { key: "endpoint", label: "Projekt-URL (NEXT_PUBLIC_SUPABASE_URL)" },
        {
          key: "token",
          label: "Publishable/anon Key oder Secret/service_role Key",
          secret: true,
        },
        { key: "name", label: "Name (optional)", optional: true },
      ],
      guide: {
        steps: [
          "Die Projekt-URL ist NEXT_PUBLIC_SUPABASE_URL, also https://<ref>.supabase.co oder die Adresse deiner selbst gehosteten Instanz.",
          "Publishable oder anon Key (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY bzw. NEXT_PUBLIC_SUPABASE_ANON_KEY): Lesen wie deine App, mit RLS. Tabellen öffnest du über ihren Namen.",
          "Secret oder service_role Key: voller Zugriff mit Tabellenliste, Auth-Benutzern und Bucket-Verwaltung. Ganze .env-Zeilen kannst du direkt einfügen.",
        ],
        link: {
          label: "Supabase-Doku zum Self-Hosting",
          url: "https://supabase.com/docs/guides/self-hosting/docker",
        },
      },
    },
    convex: {
      label: "Selbst gehostet",
      fields: [
        { key: "endpoint", label: "Backend-URL, z. B. http://127.0.0.1:3210" },
        { key: "token", label: "Admin-Key", secret: true },
      ],
      guide: {
        steps: [
          "Die Backend-URL ist CONVEX_CLOUD_ORIGIN deiner Instanz, im Docker-Setup http://127.0.0.1:3210.",
          "Einen Admin-Key erzeugst du im Backend-Container mit ./generate_admin_key.sh.",
        ],
        link: {
          label: "Convex-Doku zum Self-Hosting",
          url: "https://github.com/get-convex/convex-backend/tree/main/self-hosted",
        },
      },
    },
  };

const FIELDS: Record<BaasProvider, Field[]> = {
  supabase: [{ key: "token", label: "Personal Access Token", secret: true }],
  appwrite: [
    { key: "endpoint", label: "API-Endpunkt, z. B. https://fra.cloud.appwrite.io/v1" },
    { key: "project", label: "Projekt-ID" },
    { key: "token", label: "API-Schlüssel", secret: true },
  ],
  pocketbase: [
    { key: "endpoint", label: "URL, z. B. https://pocketbase.example.com" },
    { key: "token", label: "Superuser-Token", secret: true },
  ],
  convex: [
    { key: "project", label: "Team-ID" },
    { key: "token", label: "Team Access Token", secret: true },
  ],
  firebase: [],
};

const GUIDES: Record<BaasProvider, Guide> = {
  supabase: {
    steps: [
      "Im Supabase-Dashboard oben rechts auf dein Konto → Account preferences → Access Tokens.",
      "„Generate new token“ wählen, einen Namen vergeben und die Leserechte für Projekte, Storage, Auth und Edge Functions setzen. Für die Datenbankvorschau zusätzlich Database: Read.",
      "Den Token sofort kopieren, er wird nur einmal angezeigt.",
    ],
    link: { label: "Access Tokens öffnen", url: "https://supabase.com/dashboard/account/tokens" },
  },
  appwrite: {
    steps: [
      "In der Appwrite-Konsole das Projekt öffnen.",
      "Unter Settings stehen API-Endpunkt und Projekt-ID, beide kopieren.",
      "Unter Overview → Integrations → API keys einen Schlüssel anlegen und die Scopes für Datenbanken, Storage, Users und Functions vergeben.",
    ],
    link: { label: "Appwrite-Konsole öffnen", url: "https://cloud.appwrite.io/console" },
  },
  pocketbase: {
    steps: [
      "Die URL ist die Adresse deiner Instanz ohne /_/, z. B. https://pb.example.com.",
      "Im Admin-Dashboard (/_/) unter Collections → _superusers deinen Superuser öffnen.",
      "Über das Menü des Datensatzes „Impersonate“ wählen, eine Gültigkeitsdauer setzen und den erzeugten Token kopieren.",
    ],
    link: {
      label: "PocketBase-Doku zur Authentifizierung",
      url: "https://pocketbase.io/docs/authentication/",
    },
  },
  convex: {
    steps: [
      "Im Convex-Dashboard oben links das Team wählen und die Team Settings öffnen.",
      "Die Team-ID steht in den allgemeinen Team-Einstellungen.",
      "Unter Access Tokens einen neuen Token erstellen und kopieren.",
    ],
    link: { label: "Convex-Dashboard öffnen", url: "https://dashboard.convex.dev" },
  },
  firebase: {
    steps: [
      "In der Firebase-Konsole das Projekt öffnen und auf das Zahnrad → Projekteinstellungen klicken.",
      "Den Tab Dienstkonten öffnen und „Neuen privaten Schlüssel generieren“ wählen.",
      "Die heruntergeladene JSON-Datei hier auswählen. Das Dienstkonto braucht Leserechte für die gewünschten Dienste.",
    ],
    link: {
      label: "Firebase-Konsole öffnen",
      url: "https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk",
    },
  },
};

export function BaasConnectForm({
  provider,
  onBack,
  onSaved,
  onDirectDatabase,
}: {
  provider: BaasProvider;
  onBack: () => void;
  onSaved: () => void;
  onDirectDatabase?: () => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfHosted, setSelfHosted] = useState(false);
  const selfHostedFeature = useNewFeatureVisibility<HTMLDivElement>(
    provider === "supabase"
      ? "baas.supabase.self-hosted"
      : provider === "convex"
        ? "baas.convex.self-hosted"
        : undefined,
  );
  const variant = selfHosted ? SELF_HOSTED[provider] : undefined;
  const fields = variant?.fields ?? FIELDS[provider];
  const guide = variant?.guide ?? GUIDES[provider];
  const value = (key: string) => values[key]?.trim() ?? "";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (provider === "supabase" && selfHosted)
        await supabaseConnectSelfHosted(value("endpoint"), value("token"), value("name"));
      else if (provider === "convex" && selfHosted)
        await convexConnectSelfHosted(value("endpoint"), value("token"));
      else if (provider === "supabase") await supabaseConnect(value("token"));
      else if (provider === "appwrite")
        await appwriteConnect(value("endpoint"), value("project"), value("token"));
      else if (provider === "pocketbase")
        await pocketbaseConnect(value("endpoint"), value("token"));
      else if (provider === "convex") await convexConnect(Number(value("project")), value("token"));
      else if (!(await firebaseConnect())) return;
      await queryClient.invalidateQueries({ queryKey: [provider] });
      onSaved();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2">
        {SELF_HOSTED[provider] && (
          <div ref={selfHostedFeature.ref} className="flex items-center gap-2">
            <fieldset aria-label="Hosting" className="m-0 flex min-w-0 rounded-lg border p-0.5">
              {[false, true].map((option) => (
                <button
                  key={String(option)}
                  type="button"
                  aria-pressed={selfHosted === option}
                  onClick={() => {
                    setSelfHosted(option);
                    setValues({});
                    setError(null);
                  }}
                  className={`rounded-md px-3 py-1 text-xs transition-colors ${selfHosted === option ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {option ? SELF_HOSTED[provider]?.label : "Cloud"}
                </button>
              ))}
            </fieldset>
            {selfHostedFeature.isNew && <NewBadge />}
          </div>
        )}
        <div className="rounded-lg border bg-muted/30 p-3 text-xs">
          <p className="mb-2 font-medium">So bekommst du die Zugangsdaten</p>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => void openUrl(guide.link.url)}
            className="mt-2 inline-flex items-center gap-1 text-primary underline"
          >
            {guide.link.label} <ExternalLink className="size-3" />
          </button>
        </div>
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label htmlFor={`baas-${field.key}`} className="text-xs font-medium">
              {field.label}
            </label>
            <Input
              id={`baas-${field.key}`}
              type={field.secret ? "password" : "text"}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              autoComplete="off"
              spellCheck={false}
              required={!field.optional}
            />
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          Zugangsdaten werden im OS-Schlüsselbund gespeichert.
        </p>
        {onDirectDatabase && (
          <button
            type="button"
            onClick={onDirectDatabase}
            className="self-start text-xs text-primary underline"
          >
            Stattdessen nur die Postgres-Datenbank per URL verbinden
          </button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t bg-card/50 px-4 py-3">
        <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
          Zurück
        </Button>
        <Button
          type="submit"
          disabled={busy || fields.some((field) => !field.optional && !value(field.key))}
          className="h-11 min-w-36"
        >
          {busy
            ? "Verbinde…"
            : provider === "firebase"
              ? "Service-Account-Datei auswählen"
              : "Verbindung speichern"}
        </Button>
      </footer>
    </form>
  );
}

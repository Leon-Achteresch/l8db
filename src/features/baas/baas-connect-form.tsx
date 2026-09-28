import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  appwriteConnect,
  convexConnect,
  firebaseConnect,
  pocketbaseConnect,
  supabaseConnect,
} from "@/lib/db";
import type { BaasProvider } from "./baas-providers";

const FIELDS: Record<BaasProvider, { key: string; label: string; secret?: boolean }[]> = {
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

const GUIDES: Record<BaasProvider, { steps: string[]; link: { label: string; url: string } }> = {
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
  const fields = FIELDS[provider];
  const value = (key: string) => values[key]?.trim() ?? "";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (provider === "supabase") await supabaseConnect(value("token"));
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
        <div className="rounded-lg border bg-muted/30 p-3 text-xs">
          <p className="mb-2 font-medium">So bekommst du die Zugangsdaten</p>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            {GUIDES[provider].steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => void openUrl(GUIDES[provider].link.url)}
            className="mt-2 inline-flex items-center gap-1 text-primary underline"
          >
            {GUIDES[provider].link.label} <ExternalLink className="size-3" />
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
              required
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
          disabled={busy || fields.some((field) => !value(field.key))}
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

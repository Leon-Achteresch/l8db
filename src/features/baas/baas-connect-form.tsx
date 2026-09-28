import { useQueryClient } from "@tanstack/react-query";
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

const HINTS: Record<BaasProvider, string> = {
  supabase:
    "Persönlicher Zugangstoken aus supabase.com/dashboard/account/tokens. Für die Datenbankvorschau wird Database: Read benötigt.",
  appwrite: "API-Schlüssel mit Leserechten für die gewünschten Dienste.",
  pocketbase: "Superuser-Token der PocketBase-Instanz.",
  convex: "Team-ID und Team Access Token aus den Convex-Team-Einstellungen.",
  firebase: "Wähle eine Service-Account-JSON-Datei aus dem Firebase-Projekt.",
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
        <p className="text-sm text-muted-foreground">{HINTS[provider]}</p>
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

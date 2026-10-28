import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { connectionError } from "@/lib/connection-url";
import { useConnectionsStore } from "@/lib/connections";
import {
  type SupabaseDatabaseEndpoint,
  supabaseDatabaseEndpoint,
  testConnectionString,
} from "@/lib/db";
import { storeSecret } from "@/lib/secrets";

export function SupabaseDatabaseConnectDialog({
  reference,
  name,
  apiUrl,
  open,
  onOpenChange,
  onConnected,
}: {
  reference: string;
  name: string;
  apiUrl?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (id: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Partial<Record<keyof SupabaseDatabaseEndpoint, string>>
  >({});
  const defaults = useQuery({
    queryKey: ["supabase", reference, "database-endpoint"],
    queryFn: () => supabaseDatabaseEndpoint(reference),
    enabled: open && Boolean(apiUrl),
  });
  const field = (key: keyof SupabaseDatabaseEndpoint) =>
    overrides[key] ?? String(defaults.data?.[key] ?? "");

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const endpoint = apiUrl
        ? {
            host: field("host").trim(),
            port: Number(field("port")),
            user: field("user").trim(),
            database: field("database").trim(),
          }
        : await supabaseDatabaseEndpoint(reference);
      if (!endpoint.host || !endpoint.user || !endpoint.database)
        throw new Error("Host, Benutzer und Datenbank werden benötigt.");
      if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535)
        throw new Error("Bitte einen gültigen Port eingeben.");
      const sslMode = apiUrl && !/\.supabase\.(co|com)$/.test(endpoint.host) ? "prefer" : "require";
      const host =
        endpoint.host.includes(":") && !endpoint.host.startsWith("[")
          ? `[${endpoint.host}]`
          : endpoint.host;
      const connectionString = `postgresql://${encodeURIComponent(endpoint.user)}:${encodeURIComponent(password)}@${host}:${endpoint.port}/${encodeURIComponent(endpoint.database)}?sslmode=${sslMode}`;
      await testConnectionString("postgres", connectionString);
      const saved = useConnectionsStore.getState().addConnection({
        name,
        kind: "postgres",
        connectionString,
        sslMode,
        tunnelPort: null,
      });
      await storeSecret(saved.id, password).catch(() =>
        toast.warning(
          "Datenbankpasswort gilt nur in dieser Sitzung: Schlüsselbund nicht verfügbar.",
        ),
      );
      setPassword("");
      onOpenChange(false);
      toast.success(`Datenbank von „${name}“ verbunden`);
      onConnected?.(saved.id);
    } catch (reason) {
      setError(connectionError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Datenbank von „{name}“ verbinden</DialogTitle>
          <DialogDescription>
            {apiUrl
              ? "Host und Benutzer sind vorbelegt und änderbar. Selbst gehostet läuft die Verbindung über den Supavisor-Pooler (Benutzer postgres.<POOLER_TENANT_ID>, Passwort POSTGRES_PASSWORD aus der .env)."
              : "Host und Benutzer kommen aus deinem Supabase-Projekt. Es fehlt nur das Datenbankpasswort, das du beim Anlegen des Projekts gesetzt hast."}
          </DialogDescription>
        </DialogHeader>
        <form
          id={`supabase-db-${reference}`}
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
          className="flex flex-col gap-3"
        >
          {apiUrl &&
            (
              [
                ["host", "Host"],
                ["port", "Port"],
                ["user", "Benutzer"],
                ["database", "Datenbank"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label htmlFor={`supabase-db-${key}-${reference}`} className="text-xs font-medium">
                  {label}
                </label>
                <Input
                  id={`supabase-db-${key}-${reference}`}
                  value={field(key)}
                  inputMode={key === "port" ? "numeric" : undefined}
                  onChange={(event) =>
                    setOverrides((current) => ({ ...current, [key]: event.target.value }))
                  }
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>
            ))}
          <label htmlFor={`supabase-db-password-${reference}`} className="text-xs font-medium">
            Datenbankpasswort
          </label>
          <Input
            id={`supabase-db-password-${reference}`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            autoFocus={!apiUrl}
            required
          />
          {!apiUrl && (
            <button
              type="button"
              onClick={() =>
                void openUrl(
                  `https://supabase.com/dashboard/project/${reference}/database/settings`,
                )
              }
              className="inline-flex items-center gap-1 self-start text-xs text-primary underline"
            >
              Passwort vergessen? In den Datenbank-Einstellungen zurücksetzen
              <ExternalLink className="size-3" />
            </button>
          )}
          {defaults.isError && (
            <p role="alert" className="text-sm text-destructive">
              {String(defaults.error)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button type="submit" form={`supabase-db-${reference}`} disabled={busy || !password}>
            {busy ? "Verbinde…" : "Verbinden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

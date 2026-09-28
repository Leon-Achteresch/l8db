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
import { supabaseDatabaseEndpoint, testConnectionString } from "@/lib/db";
import { storeSecret } from "@/lib/secrets";

export function SupabaseDatabaseConnectDialog({
  reference,
  name,
  open,
  onOpenChange,
  onConnected,
}: {
  reference: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (id: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const endpoint = await supabaseDatabaseEndpoint(reference);
      const connectionString = `postgresql://${encodeURIComponent(endpoint.user)}:${encodeURIComponent(password)}@${endpoint.host}:${endpoint.port}/${encodeURIComponent(endpoint.database)}?sslmode=require`;
      await testConnectionString("postgres", connectionString);
      const saved = useConnectionsStore.getState().addConnection({
        name,
        kind: "postgres",
        connectionString,
        sslMode: "require",
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
            Host und Benutzer kommen aus deinem Supabase-Projekt. Es fehlt nur das
            Datenbankpasswort, das du beim Anlegen des Projekts gesetzt hast.
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
          <label htmlFor={`supabase-db-password-${reference}`} className="text-xs font-medium">
            Datenbankpasswort
          </label>
          <Input
            id={`supabase-db-password-${reference}`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            autoFocus
            required
          />
          <button
            type="button"
            onClick={() =>
              void openUrl(`https://supabase.com/dashboard/project/${reference}/database/settings`)
            }
            className="inline-flex items-center gap-1 self-start text-xs text-primary underline"
          >
            Passwort vergessen? In den Datenbank-Einstellungen zurücksetzen
            <ExternalLink className="size-3" />
          </button>
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

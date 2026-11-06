import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type WorkspaceProfile,
  workspaceAcceptInvitation,
  workspaceLocalStart,
  workspaceLogin,
} from "@/lib/db/workspaces";

export function WorkspaceLogin({ onConnect }: { onConnect: (profile: WorkspaceProfile) => void }) {
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:3891");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitation, setInvitation] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(local = false) {
    setBusy(true);
    setError(null);
    try {
      const address = local ? (await workspaceLocalStart(email, password)).endpoint : endpoint;
      setEndpoint(address);
      if (accepting) {
        await workspaceAcceptInvitation(address, invitation.trim(), email, password);
        setInvitation("");
        setAccepting(false);
        toast.success("Einladung angenommen");
      }
      const profile = await workspaceLogin(address, email, password);
      setPassword("");
      onConnect(profile);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-xl rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Team-Workspace verbinden</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Gemeinsame Zugänge, SQL und Rechte liegen auf eurem Workspace-Server. Entfernte Server
        benötigen HTTPS. Für einen lokalen Workspace wird beim ersten Start ein Administrator
        angelegt.
      </p>
      <form
        className="mt-5 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="workspace-endpoint">Server-Adresse</Label>
          <Input
            id="workspace-endpoint"
            type="url"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workspace-email">E-Mail</Label>
          <Input
            id="workspace-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workspace-password">Passwort</Label>
          <Input
            id="workspace-password"
            type="password"
            autoComplete={accepting ? "new-password" : "current-password"}
            minLength={12}
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            required
          />
        </div>
        {accepting && (
          <div className="space-y-1.5">
            <Label htmlFor="workspace-invitation">Einladungscode</Label>
            <Input
              id="workspace-invitation"
              autoComplete="off"
              value={invitation}
              onChange={(event) => setInvitation(event.target.value)}
              disabled={busy}
              required
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !email || !password}>
            {busy ? "Verbinde…" : accepting ? "Einladung annehmen und anmelden" : "Anmelden"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setAccepting((value) => !value)}
          >
            {accepting ? "Zur Anmeldung" : "Einladung annehmen"}
          </Button>
          {!accepting && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || !email || password.length < 12}
              onClick={() => void connect(true)}
            >
              Lokalen Workspace starten
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

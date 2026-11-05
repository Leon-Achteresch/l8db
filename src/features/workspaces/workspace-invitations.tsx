import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyWithToast } from "@/lib/clipboard";
import {
  type WorkspaceInvitation,
  type WorkspacePage,
  type WorkspaceProfile,
  workspaceRequest,
} from "@/lib/db/workspaces";
import { WorkspacePagination } from "./workspace-pagination";

export function WorkspaceInvitations({ profile }: { profile: WorkspaceProfile }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [offset, setOffset] = useState(0);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invitations = useQuery({
    queryKey: ["workspace", profile.id, "invitations", offset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceInvitation>>(profile.id, "GET", "invitations", {
        offset,
      }),
    retry: false,
  });

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      const result = await workspaceRequest<{ token: string }>(profile.id, "POST", "invitations", {
        email,
        role,
      });
      setToken(result.token);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id] });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation: WorkspaceInvitation) {
    setBusy(true);
    try {
      await workspaceRequest(profile.id, "DELETE", `invitations/${invitation.id}`);
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id] });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Einladungen</h2>
      <p className="text-sm text-muted-foreground">
        Einladungen gelten 24 Stunden, sind einmal verwendbar und an die E-Mail-Adresse gebunden.
      </p>
      <form
        className="flex max-w-2xl flex-wrap items-end gap-3 rounded-xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void invite();
        }}
      >
        <div className="min-w-52 flex-1 space-y-1.5">
          <Label htmlFor="workspace-invite-email">E-Mail</Label>
          <Input
            id="workspace-invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            required
          />
        </div>
        <Select value={role} onValueChange={setRole} disabled={busy}>
          <SelectTrigger className="w-40" aria-label="Rolle der Einladung">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Mitglied</SelectItem>
            <SelectItem value="admin">Administrator</SelectItem>
          </SelectContent>
        </Select>
        <Button disabled={busy || !email}>Einladung erstellen</Button>
      </form>
      {token && (
        <div className="max-w-2xl space-y-2 rounded-xl border bg-muted/30 p-4">
          <p className="text-sm">
            Diesen Code zusammen mit der Server-Adresse sicher an die eingeladene Person
            weitergeben. Er wird nur jetzt angezeigt.
          </p>
          <code className="block break-all text-sm">{token}</code>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyWithToast(`${profile.endpoint}\n${token}`, "Einladung")}
            >
              Adresse und Code kopieren
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setToken("")}>
              Code ausblenden
            </Button>
          </div>
        </div>
      )}
      {(error || invitations.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {error || String(invitations.error)}
        </p>
      )}
      <div className="rounded-xl border">
        {invitations.data?.items.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">Keine offenen Einladungen.</p>
        )}
        {invitations.data?.items.map((invitation) => (
          <div key={invitation.id} className="flex items-center gap-3 border-b p-3 last:border-b-0">
            <div className="flex-1">
              <p className="font-medium">{invitation.email}</p>
              <p className="text-xs text-muted-foreground">
                {invitation.role === "admin" ? "Administrator" : "Mitglied"} · gültig bis{" "}
                {new Date(invitation.expiresAt * 1000).toLocaleString()}
              </p>
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void revoke(invitation)}
            >
              Widerrufen
            </Button>
          </div>
        ))}
      </div>
      <WorkspacePagination
        offset={offset}
        more={Boolean(invitations.data?.more)}
        onChange={setOffset}
      />
    </section>
  );
}

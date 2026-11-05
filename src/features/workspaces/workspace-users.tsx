import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type WorkspaceConnection,
  type WorkspaceGrant,
  type WorkspacePage,
  type WorkspaceProfile,
  type WorkspaceUser,
  workspaceRequest,
} from "@/lib/db/workspaces";
import { WorkspacePagination } from "./workspace-pagination";

export function WorkspaceUsers({ profile }: { profile: WorkspaceProfile }) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [connectionOffset, setConnectionOffset] = useState(0);
  const [connection, setConnection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ["workspace", profile.id, "users", offset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceUser>>(profile.id, "GET", "users", { offset }),
    retry: false,
  });
  const connections = useQuery({
    queryKey: ["workspace", profile.id, "connections", connectionOffset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceConnection>>(profile.id, "GET", "connections", {
        offset: connectionOffset,
      }),
    retry: false,
  });
  const userIds = users.data?.items.map((user) => user.id).join(",") ?? "";
  const grants = useQuery({
    queryKey: ["workspace", profile.id, "grants", connection, userIds],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceGrant>>(
        profile.id,
        "GET",
        `connections/${connection}/grants`,
        { users: userIds },
      ),
    enabled: Boolean(connection && userIds),
    retry: false,
  });

  async function change(user: WorkspaceUser, action: string, body?: Record<string, unknown>) {
    setBusy(user.id);
    setError(null);
    try {
      await workspaceRequest(
        profile.id,
        action === "revoke" ? "POST" : "PATCH",
        action === "revoke" ? `users/${user.id}/revoke` : `users/${user.id}`,
        body,
      );
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id] });
      toast.success(action === "revoke" ? "Sitzungen widerrufen" : "Benutzer aktualisiert");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function grant(user: WorkspaceUser, access: string) {
    if (!connection) return;
    setBusy(user.id);
    setError(null);
    try {
      await workspaceRequest(profile.id, "PUT", `connections/${connection}/grants`, {
        userId: user.id,
        access,
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id] });
      toast.success("Verbindungsrechte aktualisiert");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Benutzer und Verbindungsrechte</h2>
      <p className="text-sm text-muted-foreground">
        Administratoren verwalten den Workspace. Mitglieder erhalten pro Verbindung Lese- oder
        Schreibrechte. Rollen- und Statusänderungen widerrufen bestehende Sitzungen.
      </p>
      <div className="max-w-xl space-y-2">
        <Select
          value={connection || "none"}
          onValueChange={(value) => setConnection(value === "none" ? "" : value)}
        >
          <SelectTrigger aria-label="Verbindung für Rechteverwaltung">
            <SelectValue placeholder="Verbindung auswählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Verbindungsrechte auswählen</SelectItem>
            {connections.data?.items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <WorkspacePagination
          offset={connectionOffset}
          more={Boolean(connections.data?.more)}
          onChange={setConnectionOffset}
        />
      </div>
      {(error || users.isError || grants.isError || connections.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {error || String(users.error || grants.error || connections.error)}
        </p>
      )}
      {users.isPending ? (
        <p role="status">Benutzer werden geladen…</p>
      ) : (
        <div className="rounded-xl border">
          {users.data?.items.map((user) => (
            <div
              key={user.id}
              className="flex flex-wrap items-center gap-3 border-b p-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{user.email}</p>
                <p className="text-xs text-muted-foreground">
                  {user.active ? "Aktiv" : "Deaktiviert"}
                  {user.id === profile.user.id ? " · Du" : ""}
                </p>
              </div>
              <Select
                value={user.role}
                disabled={busy !== null}
                onValueChange={(role) => void change(user, "update", { role, active: user.active })}
              >
                <SelectTrigger className="w-36" aria-label={`Rolle von ${user.email}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrator</SelectItem>
                  <SelectItem value="member">Mitglied</SelectItem>
                </SelectContent>
              </Select>
              {connection && user.role !== "admin" && (
                <Select
                  value={
                    grants.data?.items.find((item) => item.userId === user.id)?.access ?? "none"
                  }
                  disabled={busy !== null || grants.isPending || grants.isError}
                  onValueChange={(access) => void grant(user, access)}
                >
                  <SelectTrigger
                    className="w-40"
                    aria-label={`Verbindungsrechte von ${user.email}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Zugriff</SelectItem>
                    <SelectItem value="read">Nur lesen</SelectItem>
                    <SelectItem value="write">Lesen und Schreiben</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void change(user, "update", { role: user.role, active: !user.active })
                }
              >
                {user.active ? "Deaktivieren" : "Aktivieren"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void change(user, "revoke")}
              >
                Sitzungen widerrufen
              </Button>
            </div>
          ))}
        </div>
      )}
      <WorkspacePagination offset={offset} more={Boolean(users.data?.more)} onChange={setOffset} />
    </section>
  );
}

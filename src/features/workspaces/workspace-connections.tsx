import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DatabaseKind } from "@/lib/db";
import {
  type WorkspaceConnection,
  type WorkspacePage,
  type WorkspaceProfile,
  workspaceRequest,
} from "@/lib/db/workspaces";
import { WorkspaceConfirm } from "./workspace-confirm";
import { activateWorkspaceConnection } from "./workspace-open";
import { WorkspacePagination } from "./workspace-pagination";

export function WorkspaceConnections({ profile }: { profile: WorkspaceProfile }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState<WorkspaceConnection | null>(null);
  const [editing, setEditing] = useState<WorkspaceConnection | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DatabaseKind>("postgres");
  const [database, setDatabase] = useState("");
  const [url, setUrl] = useState("");
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = profile.user.role === "admin";
  const connections = useQuery({
    queryKey: ["workspace", profile.id, "connections", offset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceConnection>>(profile.id, "GET", "connections", {
        offset,
      }),
    retry: false,
  });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await workspaceRequest(profile.id, "POST", "connections", {
        id: editing?.id,
        name,
        kind,
        database: database.trim() || null,
        connectionString: url.trim() || null,
        requireApproval: approval,
      });
      setUrl("");
      setName("");
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id] });
      toast.success("Gemeinsamen Zugang gespeichert");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function open(connection: WorkspaceConnection) {
    if (await activateWorkspaceConnection(profile.id, connection)) await navigate({ to: "/" });
  }

  async function remove(connection: WorkspaceConnection) {
    try {
      await workspaceRequest(profile.id, "DELETE", `connections/${connection.id}`);
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id] });
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Gemeinsame Verbindungen</h2>
        <p className="text-sm text-muted-foreground">
          Datenbank-Zugangsdaten bleiben auf dem Workspace-Server. Leserechte werden zusätzlich
          serverseitig geprüft.
        </p>
      </div>
      {connections.isPending ? (
        <p role="status">Verbindungen werden geladen…</p>
      ) : connections.isError ? (
        <p role="alert" className="text-destructive">
          {String(connections.error)}
        </p>
      ) : (
        <div className="rounded-xl border">
          {connections.data.items.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">Keine freigegebenen Verbindungen.</p>
          )}
          {connections.data.items.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-wrap items-center gap-3 border-b p-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{connection.name}</p>
                <p className="text-xs text-muted-foreground">
                  {connection.kind} · {connection.database || "Standard-Datenbank"} ·{" "}
                  {connection.access === "write" ? "Lesen und Schreiben" : "Nur lesen"}
                  {connection.requireApproval ? " · Schreibfreigabe erforderlich" : ""}
                </p>
              </div>
              <Button size="sm" onClick={() => void open(connection)}>
                Öffnen
              </Button>
              {admin && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(connection);
                      setName(connection.name);
                      setKind(connection.kind);
                      setDatabase(connection.database ?? "");
                      setApproval(connection.requireApproval);
                      setUrl("");
                    }}
                  >
                    Bearbeiten
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setDeleting(connection)}>
                    Entfernen
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <WorkspacePagination
        offset={offset}
        more={Boolean(connections.data?.more)}
        onChange={setOffset}
      />
      {admin && (
        <form
          className="max-w-2xl space-y-3 rounded-xl border p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h3 className="font-semibold">
            {editing ? `„${editing.name}“ bearbeiten` : "Gemeinsamen Zugang anlegen"}
          </h3>
          <Label htmlFor="workspace-connection-name">Name</Label>
          <Input
            id="workspace-connection-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            disabled={busy}
            required
          />
          <Label>Datenbanktyp</Label>
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as DatabaseKind)}
            disabled={busy || Boolean(editing)}
          >
            <SelectTrigger aria-label="Workspace Datenbanktyp">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="postgres">PostgreSQL</SelectItem>
              <SelectItem value="mysql">MySQL / MariaDB</SelectItem>
              <SelectItem value="sqlite">SQLite</SelectItem>
            </SelectContent>
          </Select>
          <Label htmlFor="workspace-connection-database">Datenbank</Label>
          <Input
            id="workspace-connection-database"
            maxLength={256}
            value={database}
            onChange={(event) => setDatabase(event.target.value)}
            disabled={busy}
            placeholder="Standard-Datenbank"
          />
          <Label htmlFor="workspace-connection-url">Verbindungsadresse mit Zugangsdaten</Label>
          <Input
            id="workspace-connection-url"
            type="password"
            autoComplete="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={busy}
            required={!editing}
            placeholder={
              editing
                ? "Leer lassen, um gespeicherten Zugang beizubehalten"
                : "postgresql://user:password@host/database"
            }
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={approval}
              onCheckedChange={(value) => setApproval(value === true)}
              disabled={busy}
            />
            Schreibabfragen brauchen die Freigabe eines anderen Administrators
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button disabled={busy}>{busy ? "Speichere…" : "Zugang speichern"}</Button>
            {editing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setName("");
                  setUrl("");
                }}
              >
                Abbrechen
              </Button>
            )}
          </div>
        </form>
      )}
      <WorkspaceConfirm
        open={Boolean(deleting)}
        title="Gemeinsamen Zugang entfernen?"
        description={`„${deleting?.name ?? ""}“ wird mit seinen Freigaben und gespeicherten SQL-Abfragen entfernt. Die Datenbank bleibt erhalten.`}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />
      {!admin && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

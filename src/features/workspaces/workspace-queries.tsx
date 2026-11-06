import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import type { QueryResult } from "@/lib/db";
import {
  type WorkspaceConnection,
  type WorkspacePage,
  type WorkspaceProfile,
  type WorkspaceQuery,
  type WorkspaceQuerySummary,
  workspaceCancelQuery,
  workspaceRequest,
  workspaceRunQuery,
} from "@/lib/db/workspaces";
import { useTableTabs } from "@/lib/table-tabs";
import { WorkspaceConfirm } from "./workspace-confirm";
import { activateWorkspaceConnection } from "./workspace-open";
import { WorkspacePagination } from "./workspace-pagination";
import { WorkspaceResults } from "./workspace-results";

export function WorkspaceQueries({ profile }: { profile: WorkspaceProfile }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [connectionOffset, setConnectionOffset] = useState(0);
  const [offset, setOffset] = useState(0);
  const [connectionId, setConnectionId] = useState("");
  const [sql, setSql] = useState("SELECT 1");
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<WorkspaceQuerySummary | null>(null);
  const [editing, setEditing] = useState<WorkspaceQuery | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeJob = useRef<{ id: string; connectionId: string } | null>(null);
  const connections = useQuery({
    queryKey: ["workspace", profile.id, "connections", connectionOffset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceConnection>>(profile.id, "GET", "connections", {
        offset: connectionOffset,
      }),
    retry: false,
  });
  const saved = useQuery({
    queryKey: ["workspace", profile.id, "queries", connectionId, offset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceQuerySummary>>(profile.id, "GET", "queries", {
        connectionId,
        offset,
      }),
    enabled: Boolean(connectionId),
    retry: false,
  });

  useEffect(
    () => () => {
      const job = activeJob.current;
      activeJob.current = null;
      if (job) void workspaceCancelQuery(profile.id, job.connectionId, job.id).catch(() => {});
    },
    [profile.id],
  );

  async function run() {
    if (!connectionId || !sql.trim() || activeJob.current) return;
    const job = { id: crypto.randomUUID(), connectionId };
    activeJob.current = job;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const next = await workspaceRunQuery(profile.id, connectionId, sql, job.id);
      if (activeJob.current?.id === job.id) setResult(next);
    } catch (cause) {
      if (activeJob.current?.id === job.id) setError(String(cause));
    } finally {
      if (activeJob.current?.id === job.id) {
        activeJob.current = null;
        setBusy(false);
      }
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id, "pending"] });
    }
  }

  async function save() {
    if (!connectionId || !name.trim() || !sql.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await workspaceRequest<{ id: string; revision: number }>(
        profile.id,
        "POST",
        "queries",
        { id: editing?.id, expectedRevision: editing?.revision, connectionId, name, sql },
      );
      setEditing({
        id: next.id,
        revision: next.revision,
        connectionId,
        name,
        sql,
        author: editing?.author ?? profile.user.id,
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id, "queries"] });
      toast.success("Gemeinsame SQL-Abfrage gespeichert");
    } catch (cause) {
      setError(String(cause));
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id, "queries"] });
    } finally {
      setSaving(false);
    }
  }

  async function load(query: WorkspaceQuerySummary) {
    setLoading(true);
    setError(null);
    try {
      const full = await workspaceRequest<WorkspaceQuery>(profile.id, "GET", `queries/${query.id}`);
      setEditing(full);
      setSql(full.sql);
      setName(full.name);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function openEditor() {
    const connection = connections.data?.items.find((item) => item.id === connectionId);
    if (!connection || !(await activateWorkspaceConnection(profile.id, connection))) return;
    const id = useTableTabs.getState().openQueryTabWithSql(sql, name || "Team SQL");
    await navigate({ to: "/query/$id", params: { id } });
  }

  async function remove(query: WorkspaceQuerySummary) {
    try {
      await workspaceRequest(profile.id, "DELETE", `queries/${query.id}`);
      if (editing?.id === query.id) setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id, "queries"] });
    } catch (cause) {
      setError(String(cause));
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Gemeinsame SQL-Abfragen</h2>
      <p className="text-sm text-muted-foreground">
        Ausführung auf dem Workspace-Server mit deinen aktuellen Rechten. Ergebnisse sind auf 1000
        Zeilen und 4 MB begrenzt. Gespeicherte Abfragen prüfen Änderungen anderer Personen vor dem
        Überschreiben.
      </p>
      <div className="max-w-xl">
        <Select
          value={connectionId || "none"}
          disabled={busy || saving || loading}
          onValueChange={(value) => {
            setConnectionId(value === "none" ? "" : value);
            setOffset(0);
            setEditing(null);
            setResult(null);
          }}
        >
          <SelectTrigger aria-label="Verbindung für gemeinsame SQL-Abfrage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Verbindung auswählen</SelectItem>
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
          disabled={busy || saving || loading}
          onChange={(next) => {
            setConnectionOffset(next);
            setConnectionId("");
          }}
        />
      </div>
      {(connections.isError || saved.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {String(connections.error || saved.error)}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(200px,280px)_1fr]">
        <aside className="space-y-2 rounded-xl border p-3">
          <h3 className="text-sm font-medium">Gespeichert</h3>
          {saved.data?.items.length === 0 && (
            <p className="text-xs text-muted-foreground">Noch keine gemeinsamen Abfragen.</p>
          )}
          {saved.data?.items.map((query) => (
            <div key={query.id} className="flex items-center gap-1">
              <Button
                variant={editing?.id === query.id ? "secondary" : "ghost"}
                className="min-w-0 flex-1 justify-start truncate"
                disabled={busy || saving || loading}
                onClick={() => void load(query)}
              >
                {query.name}
              </Button>
              {(query.author === profile.user.id || profile.user.role === "admin") && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy || saving || loading}
                  onClick={() => setDeleting(query)}
                >
                  Löschen
                </Button>
              )}
            </div>
          ))}
          <WorkspacePagination
            offset={offset}
            more={Boolean(saved.data?.more)}
            disabled={busy || saving || loading}
            onChange={setOffset}
          />
        </aside>
        <div className="space-y-3">
          <Label htmlFor="workspace-query-name">Name</Label>
          <Input
            id="workspace-query-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            disabled={saving || loading}
            placeholder="Name für die gemeinsame SQL-Abfrage"
          />
          <Label htmlFor="workspace-query-sql">SQL</Label>
          <Textarea
            id="workspace-query-sql"
            className="min-h-56 font-mono text-sm"
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            disabled={busy || saving || loading}
            maxLength={1024 * 1024}
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!connectionId || busy || saving || loading || !sql.trim()}
              onClick={() => void run()}
            >
              {busy ? "Abfrage läuft…" : "Ausführen"}
            </Button>
            {busy && (
              <Button
                variant="outline"
                onClick={() => {
                  const job = activeJob.current;
                  if (job)
                    void workspaceCancelQuery(profile.id, job.connectionId, job.id).catch((cause) =>
                      setError(String(cause)),
                    );
                }}
              >
                Abbrechen
              </Button>
            )}
            <Button
              variant="outline"
              disabled={
                !connectionId ||
                saving ||
                loading ||
                busy ||
                !name.trim() ||
                !sql.trim() ||
                Boolean(
                  editing && editing.author !== profile.user.id && profile.user.role !== "admin",
                )
              }
              onClick={() => void save()}
            >
              {saving ? "Speichere…" : editing ? "Änderungen speichern" : "Für das Team speichern"}
            </Button>
            <Button
              variant="outline"
              disabled={!connectionId || busy || saving || loading}
              onClick={() => void openEditor()}
            >
              Im SQL-Editor öffnen
            </Button>
            <Button
              variant="ghost"
              disabled={busy || saving || loading}
              onClick={() => {
                setEditing(null);
                setName("");
              }}
            >
              Als neue Abfrage speichern
            </Button>
          </div>
        </div>
      </div>
      {loading && <p role="status">SQL wird geladen…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && <WorkspaceResults result={result} />}
      <WorkspaceConfirm
        open={Boolean(deleting)}
        title="Gemeinsame SQL-Abfrage entfernen?"
        description={`„${deleting?.name ?? ""}“ wird für alle Team-Mitglieder aus der Sammlung entfernt.`}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />
    </section>
  );
}

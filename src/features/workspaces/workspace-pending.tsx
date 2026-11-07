import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type WorkspacePending as Pending,
  type WorkspacePage,
  type WorkspacePendingSummary,
  type WorkspaceProfile,
  workspaceRequest,
} from "@/lib/db/workspaces";
import { WorkspacePagination } from "./workspace-pagination";

const STATUS: Record<Pending["status"], string> = {
  pending: "Wartet auf Freigabe",
  running: "Wird ausgeführt",
  rejected: "Abgelehnt",
  executed: "Ausgeführt",
  failed: "Fehlgeschlagen",
  cancelled: "Verworfen nach Verbindungsänderung",
};

export function WorkspacePending({ profile }: { profile: WorkspaceProfile }) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useQuery({
    queryKey: ["workspace", profile.id, "pending", offset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspacePendingSummary>>(profile.id, "GET", "pending", {
        offset,
      }),
    retry: false,
  });

  async function load(query: WorkspacePendingSummary) {
    setLoading(true);
    setDetail(null);
    setError(null);
    try {
      setDetail(await workspaceRequest<Pending>(profile.id, "GET", `pending/${query.id}`));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }

  function canApprove(query: WorkspacePendingSummary) {
    return (
      profile.user.role === "admin" &&
      query.status === "pending" &&
      detail?.id === query.id &&
      detail.status === "pending" &&
      detail.connectionId === query.connectionId &&
      detail.author === query.author &&
      detail.author !== profile.user.id &&
      detail.sql.startsWith(query.sqlPreview)
    );
  }

  async function decide(query: WorkspacePendingSummary, decision: "approve" | "reject") {
    if (decision === "approve" && !canApprove(query)) return;
    setBusy(query.id);
    setError(null);
    try {
      await workspaceRequest(profile.id, "POST", `pending/${query.id}/${decision}`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["workspace", profile.id] });
      setBusy(null);
      setDetail(null);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Schreibfreigaben</h2>
      <p className="text-sm text-muted-foreground">
        Ein anderer Administrator prüft und führt die angezeigte SQL-Anweisung einmalig aus. Rechte
        des Antragstellers werden vor der Ausführung erneut geprüft. Offene Anfragen verfallen nach
        24 Stunden.
      </p>
      {(error || pending.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {error || String(pending.error)}
        </p>
      )}
      {pending.isPending && <p role="status">Anfragen werden geladen…</p>}
      {pending.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">Keine Anfragen vorhanden.</p>
      )}
      {pending.data?.items.map((query) => (
        <article key={query.id} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm font-medium">{STATUS[query.status]}</p>
            <time className="text-xs text-muted-foreground">
              {new Date(query.createdAt * 1000).toLocaleString()}
            </time>
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {detail?.id === query.id ? detail.sql : `${query.sqlPreview}…`}
          </pre>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || loading}
            onClick={() => void load(query)}
          >
            {loading ? "SQL wird geladen…" : "Vollständige SQL prüfen"}
          </Button>
          {profile.user.role === "admin" &&
            query.author !== profile.user.id &&
            query.status === "pending" && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null || loading || !canApprove(query)}
                  onClick={() => void decide(query, "approve")}
                >
                  {busy === query.id ? "Verarbeite…" : "Freigeben und ausführen"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== null || loading}
                  onClick={() => void decide(query, "reject")}
                >
                  Ablehnen
                </Button>
              </div>
            )}
        </article>
      ))}
      <WorkspacePagination
        offset={offset}
        more={Boolean(pending.data?.more)}
        disabled={busy !== null || loading}
        onChange={(next) => {
          setOffset(next);
          setDetail(null);
        }}
      />
    </section>
  );
}

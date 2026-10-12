import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import { confirmExpertSql } from "@/lib/dashboard-file";
import { useDashboardWorkspaceStore } from "@/lib/dashboard-workspace";
import { createId, type Dashboard, useDashboardsStore } from "@/lib/dashboards";
import {
  deleteSharedDashboard,
  listSharedDashboards,
  loadSharedDashboard,
  SHARED_DASHBOARD_TABLE,
  type SqlRunner,
  saveSharedDashboard,
  supportsSharedDashboards,
} from "@/lib/dashboards/shared-table";
import { executeQuery, executeQueryWithParams } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { effectiveConnectionString } from "@/lib/ssh";

export function DashboardSharedSection({
  dashboard,
  database,
  busy,
  task,
  onOpened,
}: {
  dashboard: Dashboard | null;
  database: string | null;
  busy: boolean;
  task: (work: () => Promise<void>) => Promise<void>;
  onOpened: () => void;
}) {
  const connection = useActiveConnection();
  const enabled = useDashboardWorkspaceStore((s) => s.databaseSharing);
  const feature = useNewFeatureVisibility<HTMLElement>("dashboard.database-sharing");
  const queryClient = useQueryClient();
  const kind = connection?.kind;
  const supported = supportsSharedDashboards(kind);
  const queryKey = ["shared-dashboards", connection?.id, database];
  const runner: SqlRunner | null = connection
    ? (sql, params) => {
        const url = effectiveConnectionString(connection);
        const options = { track: false };
        return params?.length
          ? executeQueryWithParams(
              connection.kind,
              url,
              sql,
              params,
              database ?? undefined,
              options,
            )
          : executeQuery(connection.kind, url, sql, database ?? undefined, options);
      }
    : null;
  const list = useQuery({
    queryKey,
    queryFn: () => listSharedDashboards(runner as SqlRunner),
    enabled: Boolean(enabled && supported && runner),
    staleTime: 30_000,
  });
  if (!supported || !connection || !kind || !runner) return null;
  const target = database ? `„${database}“` : "der aktuellen Datenbank";
  const linked = dashboard?.sharedId && dashboard.database === database ? dashboard : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  return (
    <section ref={feature.ref} className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor="dashboard-database-sharing"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          In der Datenbank teilen
          {feature.isNew && <NewBadge />}
        </label>
        <Switch
          id="dashboard-database-sharing"
          checked={enabled}
          onCheckedChange={(next) => {
            if (
              next &&
              !window.confirm(
                `Dashboards werden als Tabelle ${SHARED_DASHBOARD_TABLE} in ${target} gespeichert. Jeder mit Zugriff auf diese Datenbank kann sie sehen, öffnen und ändern.\n\nAktivieren?`,
              )
            )
              return;
            useDashboardWorkspaceStore.getState().setDatabaseSharing(next);
          }}
        />
      </div>
      {enabled && (
        <>
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            Achtung: Gespeicherte Dashboards landen in der Tabelle{" "}
            <code className="font-mono">{SHARED_DASHBOARD_TABLE}</code> in {target}. Sie wird beim
            ersten Speichern angelegt und ist für alle mit Zugriff auf die Datenbank sichtbar.
          </p>
          <Button
            size="sm"
            disabled={!dashboard || busy}
            onClick={() =>
              void task(async () => {
                if (!dashboard) return;
                const sharedId = linked?.sharedId ?? createId();
                await saveSharedDashboard(kind, runner, sharedId, dashboard);
                useDashboardsStore.getState().update(dashboard.id, { sharedId, database });
                await refresh();
                toast.success(`Dashboard in ${SHARED_DASHBOARD_TABLE} gespeichert`);
              })
            }
          >
            {linked ? "In Datenbank aktualisieren" : "In Datenbank speichern"}
          </Button>
          {list.isError && <p className="text-xs text-destructive">{String(list.error)}</p>}
          {list.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Noch keine Dashboards in dieser Datenbank.
            </p>
          )}
          <div className="space-y-2">
            {list.data?.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <Button
                  size="xs"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      const loaded = await loadSharedDashboard(kind, runner, entry.id);
                      if (!confirmExpertSql(loaded)) return;
                      useDashboardsStore
                        .getState()
                        .importDashboard(
                          { ...loaded, locked: true, sharedId: entry.id },
                          connection.id,
                          database,
                        );
                      onOpened();
                      toast.success("Dashboard aus der Datenbank geladen");
                    })
                  }
                >
                  Öffnen
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      if (!window.confirm(`„${entry.name}“ für alle aus der Datenbank entfernen?`))
                        return;
                      await deleteSharedDashboard(kind, runner, entry.id);
                      await refresh();
                    })
                  }
                >
                  Entfernen
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

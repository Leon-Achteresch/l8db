import { Link } from "@tanstack/react-router";
import { DatabaseIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { useDashboardsStore } from "@/lib/dashboards";
import { useActiveDatabase } from "@/lib/db-selection";
import { DashboardEditor } from "./dashboard-editor";
import { DashboardLibraryDrawer } from "./dashboard-library-drawer";
import { DashboardWelcome } from "./dashboard-welcome";
import { useDashboardDatabase } from "./use-dashboard-database";

export function DashboardView() {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const store = useDashboardsStore();
  const mine = store.dashboards.filter((d) => d.connectionId === connection?.id);
  const activeId = connection ? store.active[connection.id] : undefined;
  const dashboard = mine.find((d) => d.id === activeId) ?? mine[0] ?? null;
  const switching = useDashboardDatabase(connection?.id ?? null, dashboard, database);

  if (!connection)
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <DatabaseIcon className="mx-auto mb-3 size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">Keine Verbindung aktiv</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/">Verbindung wählen</Link>
          </Button>
        </div>
      </div>
    );

  if (!dashboard)
    return (
      <>
        <DashboardLibraryDrawer
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          dashboard={null}
          dashboards={mine}
          connectionId={connection.id}
          database={database}
        />
        <DashboardWelcome
          connectionName={connection.name}
          onCreate={() => store.add(connection.id, database)}
          onOpen={() => setLibraryOpen(true)}
        />
      </>
    );

  if (switching) return null;

  return (
    <DashboardEditor
      key={dashboard.id}
      dashboard={dashboard}
      siblings={mine}
      connectionId={connection.id}
      database={database}
    />
  );
}

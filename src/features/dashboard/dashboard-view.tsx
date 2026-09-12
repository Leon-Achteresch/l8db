import { Link } from "@tanstack/react-router";
import { DatabaseIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { useDashboardsStore } from "@/lib/dashboards";
import { useActiveDatabase } from "@/lib/db-selection";
import { DashboardEditor } from "./dashboard-editor";
import { openDashboardFromFile } from "./dashboard-files";
export function DashboardView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const store = useDashboardsStore();
  const mine = store.dashboards.filter((d) => d.connectionId === connection?.id);
  const activeId = connection ? store.active[connection.id] : undefined;
  const dashboard = mine.find((d) => d.id === activeId) ?? mine[0] ?? null;

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
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="text-sm font-medium">Noch kein Dashboard für {connection.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Erstelle ein Dashboard, baue Datensätze zusammen und platziere Charts.
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" onClick={() => store.add(connection.id, database)}>
              <PlusIcon /> Dashboard erstellen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openDashboardFromFile(connection.id, database)}
            >
              <FolderOpenIcon /> Aus Datei öffnen
            </Button>
          </div>
        </div>
      </div>
    );

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

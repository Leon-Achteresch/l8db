import { useSearch } from "@tanstack/react-router";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { ImportWorkbench } from "./import-workbench";

export function ImportView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const { tab } = useSearch({ strict: false }) as { tab?: "csv" };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return <ImportWorkbench key={JSON.stringify([connection.id, database, schema, tab])} tab={tab} />;
}

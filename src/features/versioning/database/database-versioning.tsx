import { DatabaseIcon } from "lucide-react";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { providerForKind } from "@/lib/providers";
import { DatabaseBranching } from "./database-branching";

export function DatabaseVersioning() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  if (connection?.kind !== "postgres" || !database)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-10 pb-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50">
          <DatabaseIcon className="size-6 text-muted-foreground" strokeWidth={1.4} />
        </div>
        <div className="space-y-2">
          <h2 className="text-base font-semibold tracking-tight">Branches für deine Datenbank</h2>
          <p className="max-w-80 text-xs leading-relaxed text-muted-foreground">
            {!connection
              ? "Eine PostgreSQL-Verbindung öffnen, um Branches, Sicherungen und Wiederherstellungen zu verwalten."
              : connection.kind !== "postgres"
                ? `Datenbank-Branching steht für PostgreSQL zur Verfügung. ${providerForKind(connection.kind)?.name ?? connection.kind} lässt sich über „Git & Releases“ versionieren.`
                : "Eine Datenbank auswählen, um ihre Branches zu sehen."}
          </p>
        </div>
      </div>
    );
  return (
    <DatabaseBranching
      key={`${connection.id}:${database}`}
      connection={connection}
      database={database}
    />
  );
}

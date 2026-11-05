import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type WorkspaceLog,
  type WorkspacePage,
  type WorkspaceProfile,
  workspaceRequest,
} from "@/lib/db/workspaces";
import { WorkspacePagination } from "./workspace-pagination";

export function WorkspaceAudit({ profile }: { profile: WorkspaceProfile }) {
  const [offset, setOffset] = useState(0);
  const logs = useQuery({
    queryKey: ["workspace", profile.id, "logs", offset],
    queryFn: () =>
      workspaceRequest<WorkspacePage<WorkspaceLog>>(profile.id, "GET", "logs", { offset }),
    retry: false,
  });
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Workspace-Audit</h2>
      <p className="text-sm text-muted-foreground">
        Bis zu 50.000 serverseitige Ereignisse. SQL-Inhalte und Datenbank-Zugangsdaten werden hier
        nicht gespeichert.
      </p>
      {logs.isPending && <p role="status">Ereignisse werden geladen…</p>}
      {logs.isError && (
        <p role="alert" className="text-sm text-destructive">
          {String(logs.error)}
        </p>
      )}
      <div className="overflow-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-3 font-medium">Zeit</th>
              <th className="p-3 font-medium">Person</th>
              <th className="p-3 font-medium">Aktion</th>
              <th className="p-3 font-medium">Verbindung</th>
              <th className="p-3 font-medium">Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.items.map((log) => (
              <tr key={log.id} className="border-t">
                <td className="p-3 whitespace-nowrap">
                  {new Date(log.createdAt * 1000).toLocaleString()}
                </td>
                <td className="p-3">{log.actor}</td>
                <td className="p-3">{log.action}</td>
                <td className="p-3 font-mono text-xs">{log.connectionId || "—"}</td>
                <td className="p-3">{log.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <WorkspacePagination offset={offset} more={Boolean(logs.data?.more)} onChange={setOffset} />
    </section>
  );
}

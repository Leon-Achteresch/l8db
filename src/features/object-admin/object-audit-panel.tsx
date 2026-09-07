import { useQuery } from "@tanstack/react-query";
import { InfoIcon, LockIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { type ObjectAdminType, objectAuditInfo } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

interface ObjectAuditPanelProps {
  schema: string;
  name: string;
  objectType: ObjectAdminType;
}

const TYPE_LABELS: Record<string, string> = {
  table: "Tabelle",
  view: "View",
  materialized_view: "Materialized View",
  foreign_key: "Fremdschlüssel",
};

function formatValue(value: string | null | undefined) {
  if (!value) return "—";
  return value;
}

function isPermissionError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("permission") ||
    lower.includes("berechtigung") ||
    lower.includes("denied") ||
    lower.includes("privileg")
  );
}

export function ObjectAuditPanel({ schema, name, objectType }: ObjectAuditPanelProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const connectionString = connection ? effectiveConnectionString(connection) : null;
  const kind = connection?.kind;

  const audit = useQuery({
    queryKey: ["object-audit", connection?.id, database, schema, name, objectType],
    enabled: Boolean(kind && connectionString),
    queryFn: () =>
      objectAuditInfo(kind!, connectionString!, schema, name, objectType, database ?? undefined),
  });

  if (audit.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Audit-Informationen werden geladen…
      </div>
    );
  }

  if (audit.isError) {
    const message = String(audit.error);
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="flex max-w-lg items-start gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            {isPermissionError(message)
              ? "Für dieses Objekt fehlen die Rechte, um Audit-Informationen zu lesen."
              : "Audit-Informationen konnten nicht geladen werden."}
            <span className="mt-1 block font-mono text-xs">{message}</span>
          </span>
        </div>
      </div>
    );
  }

  const info = audit.data;
  if (!info) return null;

  const rows: Array<[string, string]> = [
    ["Objekt", `${info.schema}.${info.name}`],
    ["Typ", TYPE_LABELS[info.object_type] ?? info.object_type],
    ["Owner", formatValue(info.owner)],
    ["Größe", formatValue(info.size)],
    ["Zeilen (geschätzt)", info.row_estimate === null ? "—" : String(info.row_estimate)],
    ["Erstellt", formatValue(info.created_at)],
    ["Geändert", formatValue(info.changed_at)],
    ["Letztes VACUUM", formatValue(info.last_vacuum)],
    ["Letztes AUTOVACUUM", formatValue(info.last_autovacuum)],
    ["Letztes ANALYZE", formatValue(info.last_analyze)],
    ["Letztes AUTOANALYZE", formatValue(info.last_autoanalyze)],
  ];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} className="border-b last:border-b-0">
                  <th className="w-56 bg-muted/30 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                    {label}
                  </th>
                  <td className="px-3 py-1.5 font-mono text-xs">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Abhängige Objekte</span>
            <Badge variant="outline" className="text-[10px]">
              {info.dependents.length}
            </Badge>
          </div>
          {info.dependents.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
              Keine abhängigen Objekte gefunden.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <tbody>
                  {info.dependents.map((dep) => (
                    <tr
                      key={`${dep.object_type}.${dep.schema}.${dep.name}`}
                      className="border-b last:border-b-0"
                    >
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {dep.schema}.{dep.name}
                      </td>
                      <td className="w-48 px-3 py-1.5 text-xs text-muted-foreground">
                        {TYPE_LABELS[dep.object_type] ?? dep.object_type}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {info.notes.length > 0 && (
          <div className="space-y-1.5">
            {info.notes.map((note) => (
              <p
                key={note}
                className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
              >
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                {note}
              </p>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

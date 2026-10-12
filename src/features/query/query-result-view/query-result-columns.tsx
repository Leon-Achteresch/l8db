import { ExternalLinkIcon, KeyRoundIcon, LinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DetailedColumnInfo, ForeignKeyInfo } from "@/lib/db";
import type { ColumnOrigin } from "@/lib/query-result-view";
import { QUERY_RESULT_SCHEMA } from "@/lib/query-result-view";

interface QueryResultColumnsProps {
  columns: DetailedColumnInfo[];
  origins: (ColumnOrigin | null)[];
  foreignKeys: ForeignKeyInfo[];
  loading: boolean;
  onOpenTable: (schema: string, table: string) => void;
}

export function QueryResultColumns({
  columns,
  origins,
  foreignKeys,
  loading,
  onOpenTable,
}: QueryResultColumnsProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted/60 text-left text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="w-12 border-b px-3 py-2 font-medium">#</th>
            <th className="border-b px-3 py-2 font-medium">Name</th>
            <th className="border-b px-3 py-2 font-medium">Typ</th>
            <th className="border-b px-3 py-2 font-medium">Schlüssel</th>
            <th className="border-b px-3 py-2 font-medium">Herkunft</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column, index) => {
            const origin = origins[index] ?? null;
            const references = foreignKeys.filter(
              (fk) => fk.from_schema === QUERY_RESULT_SCHEMA && fk.from_column === column.name,
            );
            return (
              <tr key={column.name} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {column.ordinal_position}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{column.name}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {column.data_type || "–"}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {column.is_primary_key && (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <KeyRoundIcon className="size-3" />
                        PK
                      </Badge>
                    )}
                    {references.map((fk) => (
                      <Badge
                        key={`${fk.constraint_name}:${fk.to_schema}.${fk.to_table}.${fk.to_column}`}
                        variant="outline"
                        className="gap-1 text-[10px]"
                        title={fk.constraint_name}
                      >
                        <LinkIcon className="size-3" />
                        {fk.to_table}.{fk.to_column}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-1">
                  {origin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-1.5 font-mono text-xs"
                      title={`${origin.schema}.${origin.table} öffnen`}
                      onClick={() => onOpenTable(origin.schema, origin.table)}
                    >
                      {origin.schema}.{origin.table}.{origin.column}
                      <ExternalLinkIcon className="size-3" />
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {loading ? "wird ermittelt…" : "berechnet"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

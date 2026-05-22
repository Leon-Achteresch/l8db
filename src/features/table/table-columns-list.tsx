import { Columns2Icon, KeyRoundIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useDetailedColumnsQuery } from "@/lib/queries";

interface TableColumnsListProps {
  schema: string;
  table: string;
}

export function TableColumnsList({ schema, table }: TableColumnsListProps) {
  const { data: columns, isLoading } = useDetailedColumnsQuery(schema, table);

  const count = columns?.length ?? 0;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade Columns…
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Columns vorhanden.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
        <Columns2Icon className="size-4 text-blue-500" />
        <span className="text-sm font-medium text-foreground">
          {count} {count === 1 ? "Column" : "Columns"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-0.5">
          {columns!.map((column) => {
            const dataType =
              column.character_maximum_length != null
                ? `${column.data_type}(${column.character_maximum_length})`
                : column.data_type;

            return (
              <div
                key={column.name}
                className="flex items-center gap-3 rounded-md px-3 py-2.5"
              >
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                  {column.ordinal_position}
                </span>
                {column.is_primary_key ? (
                  <KeyRoundIcon className="size-4 shrink-0 text-yellow-500" />
                ) : (
                  <Columns2Icon className="size-4 shrink-0 text-blue-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {column.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {dataType}
                </span>
                {!column.is_nullable && (
                  <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                    NOT NULL
                  </Badge>
                )}
                {column.column_default != null && (
                  <Badge variant="secondary" className="max-w-[12rem] shrink-0 truncate px-1.5 py-0 text-[10px]">
                    {column.column_default}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

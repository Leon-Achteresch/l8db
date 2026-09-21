import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { SavedConnection } from "@/lib/connections";
import { listTableColumnsDetailed } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import type { DataCompareSideSelection } from "./data-compare-side-picker";

export function DataCompareKeyPicker({
  connection,
  value,
  onChange,
}: {
  connection: SavedConnection;
  value: DataCompareSideSelection;
  onChange: (value: DataCompareSideSelection) => void;
}) {
  const id = useId();
  const columns = useQuery({
    queryKey: ["compare-key-columns", connection.id, value.database, value.schema, value.table],
    queryFn: () =>
      listTableColumnsDetailed(
        connection.kind,
        effectiveConnectionString(connection),
        value.schema as string,
        value.table as string,
        value.database ?? undefined,
      ),
    enabled: Boolean(value.schema && value.table),
  });
  return (
    <fieldset className="flex flex-wrap gap-2 text-xs">
      <legend className="mb-2">Vergleichsschlüssel (Standard: Primärschlüssel)</legend>
      {columns.error && <span className="text-destructive">{String(columns.error)}</span>}
      {columns.data?.map((column) => (
        <label
          htmlFor={`${id}-${column.name}`}
          key={column.name}
          className="flex items-center gap-1"
        >
          <Checkbox
            id={`${id}-${column.name}`}
            checked={value.keyColumns?.includes(column.name) ?? false}
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                keyColumns: checked
                  ? [...(value.keyColumns ?? []), column.name]
                  : value.keyColumns?.filter((name) => name !== column.name),
              })
            }
          />
          {column.name}
        </label>
      ))}
    </fieldset>
  );
}

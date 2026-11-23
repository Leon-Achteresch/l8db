import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VariableColumn } from "@/lib/dashboards";
import { useTablesQuery, useViewsQuery } from "@/lib/queries";
import { ColumnSelect } from "./dataset-column-select";
import { useTablesColumns } from "./use-dataset-query";

const key = (schema: string, table: string) => JSON.stringify([schema, table]);

export function VariableColumnSource({
  value,
  onChange,
}: {
  value: VariableColumn | null;
  onChange: (value: VariableColumn | null) => void;
}) {
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const sources = [...(tables.data ?? []), ...(views.data ?? [])];
  const [columns] = useTablesColumns(value ? [{ schema: value.schema, table: value.table }] : []);
  const options = (columns?.data ?? []).map((c) => ({
    ref: c.name,
    label: c.name,
    type: c.data_type,
  }));
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <Select
        value={value ? key(value.schema, value.table) : undefined}
        onValueChange={(next) => {
          const [schema, table] = JSON.parse(next) as [string, string];
          onChange({ schema, table, column: "" });
        }}
      >
        <SelectTrigger size="sm" aria-label="Tabelle" className="h-8 w-full text-xs">
          <SelectValue placeholder="Tabelle" />
        </SelectTrigger>
        <SelectContent searchable={sources.length > 8}>
          {sources.map((source) => (
            <SelectItem
              key={key(source.schema, source.name)}
              value={key(source.schema, source.name)}
            >
              {source.schema ? `${source.schema}.${source.name}` : source.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ColumnSelect
        label="Spalte"
        placeholder={columns?.isLoading ? "Lädt…" : "Spalte"}
        value={value?.column || null}
        columns={options}
        onChange={(column) => {
          if (!value) return;
          const type = options.find((option) => option.ref === column)?.type;
          onChange({
            schema: value.schema,
            table: value.table,
            column: column ?? "",
            ...(type ? { dataType: type } : {}),
          });
        }}
      />
    </div>
  );
}

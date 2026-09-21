import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { SavedConnection } from "@/lib/connections";
import type { ImportTargetColumn } from "@/lib/csv-import";
import { type CsvImportConflict, listConstraints } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";

export function CsvConflictOptions({
  connection,
  database,
  schema,
  table,
  columns,
  mapped,
  value,
  onChange,
}: {
  connection: SavedConnection;
  database: string | null;
  schema: string;
  table: string;
  columns: ImportTargetColumn[];
  mapped: string[];
  value?: CsvImportConflict;
  onChange: (value: CsvImportConflict | undefined) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState(
    value ? (value.update_columns.length ? "update" : "skip") : "abort",
  );
  const constraints = useQuery({
    queryKey: ["import-conflicts", connection.id, database, schema, table],
    queryFn: () =>
      listConstraints(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        database ?? undefined,
      ),
  });
  const keys = constraints.data?.filter((constraint) =>
    ["PRIMARY KEY", "UNIQUE"].includes(constraint.constraint_type),
  );
  const key = keys?.find((key) => key.name === value?.constraint);
  return (
    <fieldset className="flex flex-col gap-2 text-xs">
      <legend>Bei Konflikten</legend>
      <select
        aria-label="Konfliktstrategie"
        className="rounded border bg-background p-2"
        value={mode}
        onChange={(event) => {
          const mode = event.target.value;
          setMode(mode);
          onChange(mode === "abort" ? undefined : { constraint: "", update_columns: [] });
        }}
      >
        <option value="abort">Abbrechen und vollständig zurückrollen</option>
        <option value="skip">Überspringen</option>
        <option value="update">Ausgewählte Spalten aktualisieren</option>
      </select>
      {mode !== "abort" && (
        <>
          <select
            aria-label="Konfliktschlüssel"
            className="rounded border bg-background p-2"
            value={value?.constraint ?? ""}
            onChange={(event) => onChange({ constraint: event.target.value, update_columns: [] })}
          >
            <option value="">Konfliktschlüssel ausdrücklich wählen</option>
            {keys?.map((key) => (
              <option key={key.name} value={key.name}>
                {key.name} ({key.columns.join(", ")})
              </option>
            ))}
          </select>
          {constraints.error && (
            <span className="text-destructive">{String(constraints.error)}</span>
          )}
          {mode === "update" &&
            columns
              .filter(
                (column) =>
                  mapped.includes(column.name) &&
                  !column.is_generated &&
                  !column.is_identity &&
                  !key?.columns.includes(column.name),
              )
              .map((column) => (
                <label
                  key={column.name}
                  htmlFor={`${id}-${column.name}`}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    id={`${id}-${column.name}`}
                    checked={value?.update_columns.includes(column.name) ?? false}
                    onCheckedChange={(checked) =>
                      onChange({
                        constraint: value?.constraint ?? "",
                        update_columns: checked
                          ? [...(value?.update_columns ?? []), column.name]
                          : (value?.update_columns ?? []).filter((name) => name !== column.name),
                      })
                    }
                  />
                  {column.name}
                </label>
              ))}
          <p>
            Vorschau:{" "}
            {value?.update_columns.length
              ? `Aktualisieren: ${value.update_columns.join(", ")}`
              : "Konflikte werden übersprungen; keine Spalte wird aktualisiert."}
          </p>
        </>
      )}
    </fieldset>
  );
}

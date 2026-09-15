import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { masterDetailRelationSql, masterDetailRelations } from "@/lib/master-detail-relations";
import { useForeignKeysQuery } from "@/lib/queries";

export function MasterDetailRelationPicker({
  schema,
  table,
  selectedColumn,
  target,
  autoLoad = false,
  onLoad,
}: {
  schema: string;
  table: string;
  selectedColumn?: string;
  target?: { schema: string; table: string };
  autoLoad?: boolean;
  onLoad: (sql: string) => void;
}) {
  const connection = useActiveConnection();
  const query = useForeignKeysQuery(schema, table);
  const relations = useMemo(
    () => masterDetailRelations(query.data ?? [], schema, table),
    [query.data, schema, table],
  );
  const [chosen, setChosen] = useState("");
  const preferred =
    relations.find(
      (entry) =>
        entry.schema === target?.schema &&
        entry.table === target.table &&
        entry.columns.some((column) => column.source === selectedColumn),
    ) ??
    relations.find((entry) => entry.schema === target?.schema && entry.table === target.table) ??
    relations.find((entry) => entry.columns.some((column) => column.source === selectedColumn)) ??
    relations[0];
  const relation = relations.find((entry) => entry.id === chosen) ?? preferred;
  const kind = connection?.kind;
  const preferredId = preferred?.id;
  useEffect(() => {
    if (!autoLoad || !kind) return;
    const entry = relations.find((item) => item.id === preferredId);
    if (entry) onLoad(masterDetailRelationSql(entry, kind));
  }, [autoLoad, kind, preferredId, relations, onLoad]);
  if (query.error)
    return (
      <div role="alert" className="text-xs text-destructive">
        Beziehungen konnten nicht geladen werden: {String(query.error)}{" "}
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
          Erneut versuchen
        </Button>
      </div>
    );
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 text-xs font-medium">Beziehung</div>
      <div className="flex items-center gap-2">
        <select
          aria-label="FK-/PK-Beziehung"
          value={relation?.id ?? ""}
          disabled={!relations.length}
          onChange={(event) => {
            setChosen(event.target.value);
            const entry = relations.find((item) => item.id === event.target.value);
            if (entry && connection) onLoad(masterDetailRelationSql(entry, connection.kind));
          }}
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
        >
          {!relations.length && (
            <option value="">
              {query.isLoading
                ? "Beziehungen werden geladen…"
                : "Keine FK-/PK-Beziehungen gefunden"}
            </option>
          )}
          {(["parent", "child"] as const).map((direction) => (
            <optgroup
              key={direction}
              label={
                direction === "parent"
                  ? "FK → Referenzierte PK-/Unique-Tabelle"
                  : "PK/Unique → Abhängige FK-Tabelle"
              }
            >
              {relations
                .filter((entry) => entry.direction === direction)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.schema}.{entry.table} ·{" "}
                    {entry.columns
                      .map((column) => `${column.source} → ${column.target}`)
                      .join(", ")}{" "}
                    · {entry.constraint}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {relation
          ? `${table}.${relation.columns.map((column) => column.source).join(", ")} → ${relation.table}.${relation.columns.map((column) => column.target).join(", ")}`
          : "Keine Beziehung gefunden · unten eigenes SQL schreiben."}
      </p>
    </div>
  );
}

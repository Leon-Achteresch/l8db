import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConvexIndex } from "@/lib/db/convex-studio-data";
import {
  EMPTY_FILTER,
  FILTER_OPS,
  type FilterState,
  tableIndexes,
  type UiFilterOp,
  VALUE_TYPES,
} from "./convex-data-utils";

export function ConvexDataFilterPanel({
  table,
  columns,
  indexes,
  initial,
  error,
  onApply,
}: {
  table: string;
  columns: string[];
  indexes: ConvexIndex[];
  initial: FilterState;
  error: string | null;
  onApply: (state: FilterState) => void;
}) {
  const [state, setState] = useState(initial);
  const { database, search } = tableIndexes(indexes, table);
  const index = database.find((item) => item.name === state.indexName);
  const searchIndex = search.find((item) => item.name === state.indexName);
  const update = (patch: Partial<FilterState>) => setState((current) => ({ ...current, ...patch }));
  const setClause = (position: number, patch: Partial<FilterState["clauses"][number]>) =>
    update({
      clauses: state.clauses.map((clause, index) =>
        index === position ? { ...clause, ...patch } : clause,
      ),
    });

  return (
    <form
      className="grid gap-3 rounded-lg border bg-muted/20 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(state);
      }}
    >
      <datalist id={`convex-data-fields-${table}`}>
        {columns.map((column) => (
          <option key={column} value={column} />
        ))}
      </datalist>
      <div className="grid gap-2">
        <p className="text-xs font-medium">Abfrage über</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={state.mode === "none" ? "none" : `${state.mode}:${state.indexName}`}
            onValueChange={(value) => {
              const [mode, name = ""] = value.split(":");
              update({
                mode: mode as FilterState["mode"],
                indexName: name,
                indexValues: [],
                searchValues: [],
              });
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-64 text-xs" aria-label="Index">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tabellenscan (nach _creationTime)</SelectItem>
              {database.map((item) => (
                <SelectItem key={item.name} value={`index:${item.name}`}>
                  Index {item.name} ({item.fields.join(", ")})
                </SelectItem>
              ))}
              {search.map((item) => (
                <SelectItem key={item.name} value={`search:${item.name}`}>
                  Volltext {item.name} ({item.searchField})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {state.mode === "search" && (
            <Input
              value={state.search}
              onChange={(event) => update({ search: event.target.value })}
              placeholder={`Suche in ${searchIndex?.searchField ?? "…"}`}
              aria-label="Suchbegriff"
              className="h-8 w-64 text-xs"
            />
          )}
        </div>
        {state.mode === "index" &&
          index?.fields
            .filter((field) => field !== "_creationTime")
            .map((field, position) => (
              <div key={field} className="flex items-center gap-2">
                <span className="w-32 truncate font-mono text-xs">{field} =</span>
                <Input
                  value={state.indexValues[position] ?? ""}
                  onChange={(event) => {
                    const values = [...state.indexValues];
                    values[position] = event.target.value;
                    update({ indexValues: values });
                  }}
                  placeholder="Wert (JSON), leer = alle"
                  aria-label={`Indexwert ${field}`}
                  spellCheck={false}
                  className="h-8 w-64 font-mono text-xs"
                />
              </div>
            ))}
        {state.mode === "search" &&
          searchIndex?.filterFields.map((field, position) => (
            <div key={field} className="flex items-center gap-2">
              <span className="w-32 truncate font-mono text-xs">{field} =</span>
              <Input
                value={state.searchValues[position] ?? ""}
                onChange={(event) => {
                  const values = [...state.searchValues];
                  values[position] = event.target.value;
                  update({ searchValues: values });
                }}
                placeholder="Wert (JSON), leer = alle"
                aria-label={`Suchfilter ${field}`}
                spellCheck={false}
                className="h-8 w-64 font-mono text-xs"
              />
            </div>
          ))}
        {state.mode === "search" && (
          <p className="text-[11px] text-muted-foreground">
            Volltextsuche liefert Treffer nach Relevanz; die Sortierung ist dabei fest.
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-medium">Filter</p>
        {state.clauses.map((clause, position) => (
          <div key={clause.key} className="flex flex-wrap items-center gap-2">
            <Input
              value={clause.field}
              onChange={(event) => setClause(position, { field: event.target.value })}
              list={`convex-data-fields-${table}`}
              placeholder="Feld (a.b für verschachtelt)"
              aria-label="Feld"
              spellCheck={false}
              className="h-8 w-48 font-mono text-xs"
            />
            <Select
              value={clause.op}
              onValueChange={(value) => setClause(position, { op: value as UiFilterOp })}
            >
              <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label="Operator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clause.op === "type" || clause.op === "notype" ? (
              <Select
                value={clause.value || "string"}
                onValueChange={(value) => setClause(position, { value })}
              >
                <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label="Typ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VALUE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : clause.op === "defined" || clause.op === "undefined" ? null : (
              <Input
                value={clause.value}
                onChange={(event) => setClause(position, { value: event.target.value })}
                placeholder='Wert als JSON, z. B. "Ada" oder 5'
                aria-label="Wert"
                spellCheck={false}
                className="h-8 w-56 font-mono text-xs"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Filter entfernen"
              onClick={() =>
                update({ clauses: state.clauses.filter((_, index) => index !== position) })
              }
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update({
                clauses: [
                  ...state.clauses,
                  { key: crypto.randomUUID(), field: columns[1] ?? "", op: "eq", value: "" },
                ],
              })
            }
          >
            <Plus className="size-3.5" /> Bedingung
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Anwenden
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setState(EMPTY_FILTER);
            onApply(EMPTY_FILTER);
          }}
        >
          Zurücksetzen
        </Button>
      </div>
    </form>
  );
}

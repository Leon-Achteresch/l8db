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
import type { StudioFilterOperator, StudioRowFilter } from "@/lib/db/supabase-studio-tables";
import { FILTER_OPERATORS } from "./supabase-tables-utils";

const needsValue = (operator: StudioFilterOperator) =>
  operator !== "is_null" && operator !== "not_null";

export function SupabaseTableFilters({
  columns,
  filters,
  onApply,
}: {
  columns: string[];
  filters: StudioRowFilter[];
  onApply: (filters: StudioRowFilter[]) => void;
}) {
  const [draft, setDraft] = useState(() =>
    filters.map((filter) => ({ ...filter, uid: crypto.randomUUID() })),
  );

  function change(index: number, patch: Partial<StudioRowFilter>) {
    setDraft((current) =>
      current.map((filter, position) => (position === index ? { ...filter, ...patch } : filter)),
    );
  }

  const valid = draft.every(
    (filter) => filter.column && (!needsValue(filter.operator) || filter.value?.length),
  );

  return (
    <form
      className="grid gap-2 rounded-lg border bg-muted/20 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid)
          onApply(
            draft.map(({ uid: _uid, ...filter }) => ({
              ...filter,
              value: needsValue(filter.operator) ? filter.value : null,
            })),
          );
      }}
    >
      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground">Keine Filter. Alle Zeilen werden angezeigt.</p>
      )}
      {draft.map((filter, index) => (
        <div key={filter.uid} className="flex flex-wrap items-center gap-2">
          <Select value={filter.column} onValueChange={(column) => change(index, { column })}>
            <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label="Filterspalte">
              <SelectValue placeholder="Spalte" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((column) => (
                <SelectItem key={column} value={column}>
                  {column}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.operator}
            onValueChange={(operator) =>
              change(index, { operator: operator as StudioFilterOperator })
            }
          >
            <SelectTrigger size="sm" className="h-8 w-32 text-xs" aria-label="Operator">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPERATORS.map((operator) => (
                <SelectItem key={operator.value} value={operator.value}>
                  {operator.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {needsValue(filter.operator) && (
            <Input
              value={filter.value ?? ""}
              onChange={(event) => change(index, { value: event.target.value })}
              placeholder={filter.operator === "in" ? "a, b, c" : "Wert"}
              aria-label="Filterwert"
              className="h-8 w-48 font-mono text-xs"
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Filter entfernen"
            onClick={() =>
              setDraft((current) => current.filter((_, position) => position !== index))
            }
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={columns.length === 0 || draft.length >= 20}
          onClick={() =>
            setDraft((current) => [
              ...current,
              { uid: crypto.randomUUID(), column: columns[0] ?? "", operator: "eq", value: "" },
            ])
          }
        >
          <Plus className="size-3.5" /> Filter
        </Button>
        <Button type="submit" size="sm" disabled={!valid}>
          Anwenden
        </Button>
      </div>
    </form>
  );
}

import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterOperatorSelect } from "@/features/filters/filter-operator-select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import { filterSupportsOr, operatorNeedsValue } from "@/lib/sql-filter";
import type { FilterCondition as Condition } from "@/lib/table-view-state";
import type { Combinator } from "./filter-types";

export function FilterConditionRow({
  condition,
  index,
  kind,
  combinator,
  setCombinator,
  columns,
  updateCondition,
  removeCondition,
  onColumnSelect,
  apply,
}: {
  condition: Condition;
  index: number;
  kind: Parameters<typeof filterSupportsOr>[0];
  combinator: Combinator;
  setCombinator: (value: Combinator) => void;
  columns: string[];
  updateCondition: (id: string, patch: Partial<Condition>) => void;
  removeCondition: (id: string) => void;
  onColumnSelect?: (column: string) => void;
  apply: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="shrink-0 text-xs text-muted-foreground sm:w-16 sm:text-right">
        {index === 0 ? (
          "Wo"
        ) : (
          <Select
            value={filterSupportsOr(kind) ? combinator : "AND"}
            onValueChange={(value) => setCombinator(value as Combinator)}
          >
            <SelectTrigger size="sm" className="w-24 sm:w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="AND">und</SelectItem>
              {filterSupportsOr(kind) && <SelectItem value="OR">oder</SelectItem>}
            </SelectContent>
          </Select>
        )}
      </div>

      <Select
        value={condition.column}
        onValueChange={(value) => {
          updateCondition(condition.id, { column: value, dataType: undefined });
          onColumnSelect?.(value);
        }}
      >
        <SelectTrigger size="sm" className="w-full min-w-0 sm:min-w-40 sm:flex-1">
          <SelectValue placeholder="Spalte wählen…" />
        </SelectTrigger>
        <SelectContent position="popper" searchable>
          {columns.map((column) => (
            <SelectItem key={column} value={column}>
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <FilterOperatorSelect
        operator={condition.operator}
        value={condition.value}
        onChange={(operator, value) => updateCondition(condition.id, { operator, value })}
        className="w-full min-w-0 sm:w-auto sm:min-w-44"
        size="sm"
      />

      {operatorNeedsValue(condition.operator) ? (
        <FilterValueInput
          key={condition.operator}
          operator={condition.operator}
          value={condition.value}
          onValueChange={(value) =>
            updateCondition(condition.id, {
              value,
            })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              apply();
            }
          }}
          placeholder="Wert"
          className="h-8 w-full min-w-0 sm:min-w-32 sm:flex-1"
        />
      ) : (
        <div className="hidden sm:block sm:min-w-32 sm:flex-1" />
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => removeCondition(condition.id)}
        aria-label="Bedingung entfernen"
        className="self-end sm:self-auto"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

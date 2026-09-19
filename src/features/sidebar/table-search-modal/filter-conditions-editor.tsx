import { PlusIcon, Trash2Icon } from "lucide-react";
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
import type { useActiveConnection } from "@/lib/connections";
import { filterSupportsOr, operatorNeedsValue } from "@/lib/sql-filter";
import type { Combinator, Condition } from "./types";

interface FilterConditionsEditorProps {
  kind: NonNullable<ReturnType<typeof useActiveConnection>>["kind"] | undefined;
  conditions: Condition[];
  combinator: Combinator;
  setCombinator: (value: Combinator) => void;
  selectedColumns: string[];
  compiledSimple: string;
  updateCondition: (id: string, patch: Partial<Condition>) => void;
  addCondition: () => void;
  removeCondition: (id: string) => void;
  handleOpen: () => void;
}

export function FilterConditionsEditor({
  kind,
  conditions,
  combinator,
  setCombinator,
  selectedColumns,
  compiledSimple,
  updateCondition,
  addCondition,
  removeCondition,
  handleOpen,
}: FilterConditionsEditorProps) {
  return (
    <>
      {conditions.map((condition, index) => (
        <div key={condition.id} className="flex flex-col gap-1.5">
          <div className="text-[10px] text-muted-foreground">
            {index === 0 ? (
              "Wo"
            ) : (
              <Select
                value={filterSupportsOr(kind) ? combinator : "AND"}
                onValueChange={(value) => setCombinator(value as Combinator)}
              >
                <SelectTrigger size="sm" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="AND">und</SelectItem>
                  {filterSupportsOr(kind) && <SelectItem value="OR">oder</SelectItem>}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Select
              value={condition.column}
              onValueChange={(value) =>
                updateCondition(condition.id, {
                  column: value,
                })
              }
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder="Spalte..." />
              </SelectTrigger>
              <SelectContent position="popper" searchable>
                {selectedColumns.map((col) => (
                  <SelectItem key={col} value={col}>
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FilterOperatorSelect
              operator={condition.operator}
              value={condition.value}
              onChange={(operator, value) => updateCondition(condition.id, { operator, value })}
              className="w-auto min-w-0 shrink-0"
              size="sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => removeCondition(condition.id)}
              aria-label="Bedingung entfernen"
            >
              <Trash2Icon />
            </Button>
          </div>
          {operatorNeedsValue(condition.operator) && (
            <FilterValueInput
              key={condition.operator}
              operator={condition.operator}
              value={condition.value}
              onValueChange={(value) =>
                updateCondition(condition.id, {
                  value,
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleOpen();
              }}
              placeholder="Wert"
              className="h-7 text-xs"
            />
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="xs" onClick={addCondition} className="w-full">
        <PlusIcon />
        Bedingung
      </Button>
      {compiledSimple && (
        <p className="break-all font-mono text-[10px] text-muted-foreground">
          {kind === "mongodb" ? "JSON" : "WHERE"} {compiledSimple}
        </p>
      )}
    </>
  );
}

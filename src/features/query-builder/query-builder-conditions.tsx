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
import {
  type BuilderCondition,
  type ColumnOption,
  columnOptionValue,
  parseColumnOptionValue,
} from "@/lib/query-builder";
import { operatorNeedsValue } from "@/lib/sql-filter";

interface QueryBuilderConditionsProps {
  conditions: BuilderCondition[];
  options: ColumnOption[];
  onChange: (id: string, patch: Partial<BuilderCondition>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function QueryBuilderConditions({
  conditions,
  options,
  onChange,
  onAdd,
  onRemove,
}: QueryBuilderConditionsProps) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Bedingungen (UND)</span>
        <Button size="sm" variant="ghost" onClick={onAdd} disabled={options.length === 0}>
          <PlusIcon />
          Bedingung
        </Button>
      </div>
      <div className="space-y-2 p-3">
        {conditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Bedingungen definiert.</p>
        ) : (
          conditions.map((condition) => (
            <div key={condition.id} className="flex items-center gap-2">
              <Select
                value={columnOptionValue(condition.source, condition.column)}
                onValueChange={(value) =>
                  onChange(condition.id, {
                    ...parseColumnOptionValue(value),
                    dataType: options.find((option) => option.value === value)?.dataType,
                  })
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Spalte" />
                </SelectTrigger>
                <SelectContent searchable>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FilterOperatorSelect
                operator={condition.operator}
                value={condition.value}
                onChange={(operator, value) => onChange(condition.id, { operator, value })}
                className="w-44"
                size="sm"
              />
              {operatorNeedsValue(condition.operator) ? (
                <FilterValueInput
                  key={condition.operator}
                  operator={condition.operator}
                  className="flex-1"
                  placeholder="Wert"
                  value={condition.value}
                  onValueChange={(value) => onChange(condition.id, { value })}
                />
              ) : (
                <div className="flex-1" />
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label="Bedingung entfernen"
                onClick={() => onRemove(condition.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

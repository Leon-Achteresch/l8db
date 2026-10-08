import { XIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterOperatorSelect } from "@/features/filters/filter-operator-select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import { QueryBuilderSection } from "@/features/query-builder/query-builder-section";
import { useListAnimation } from "@/lib/hooks/use-list-animation";
import {
  type BuilderCondition,
  type ColumnOption,
  columnOptionValue,
  parseColumnOptionValue,
} from "@/lib/query-builder";
import { isDateFilterType, operatorNeedsValue } from "@/lib/sql-filter";

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
  const listRef = useListAnimation<HTMLDivElement>();
  return (
    <QueryBuilderSection
      title="Filter"
      count={conditions.length}
      addLabel="Bedingung hinzufügen"
      addDisabled={options.length === 0}
      onAdd={onAdd}
    >
      <div ref={listRef} className="space-y-1.5">
        {conditions.map((condition, index) => (
          <div key={condition.id} className="space-y-1 rounded-md border bg-background p-1.5">
            <div className="flex items-center gap-1">
              <span className="w-7 shrink-0 text-center text-[11px] text-muted-foreground">
                {index === 0 ? "wo" : "und"}
              </span>
              <Select
                value={columnOptionValue(condition.source, condition.column)}
                onValueChange={(value) =>
                  onChange(condition.id, {
                    ...parseColumnOptionValue(value),
                    dataType: options.find((option) => option.value === value)?.dataType,
                  })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 min-w-0 flex-1 font-mono text-xs"
                  aria-label="Spalte"
                >
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
              <IconButton
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground"
                aria-label="Bedingung entfernen"
                onClick={() => onRemove(condition.id)}
              >
                <XIcon />
              </IconButton>
            </div>
            <div className="flex items-center gap-1 pl-8">
              <FilterOperatorSelect
                operator={condition.operator}
                value={condition.value}
                onChange={(operator, value) => onChange(condition.id, { operator, value })}
                className="h-7 w-28 shrink-0 text-xs"
                size="sm"
                date={isDateFilterType(condition.dataType)}
              />
              {operatorNeedsValue(condition.operator) && (
                <FilterValueInput
                  key={condition.operator}
                  operator={condition.operator}
                  date={isDateFilterType(condition.dataType)}
                  className="h-7 min-w-0 flex-1 font-mono text-xs"
                  placeholder="Wert"
                  value={condition.value}
                  onValueChange={(value) => onChange(condition.id, { value })}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </QueryBuilderSection>
  );
}

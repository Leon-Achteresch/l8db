import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type BuilderCondition,
  type ColumnOption,
  columnOptionValue,
  parseColumnOptionValue,
} from "@/lib/query-builder";
import { OPERATORS, operatorNeedsValue } from "@/lib/sql-filter";

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
                onValueChange={(value) => onChange(condition.id, parseColumnOptionValue(value))}
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
              <Select
                value={condition.operator}
                onValueChange={(value) => onChange(condition.id, { operator: value })}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((operator) => (
                    <SelectItem key={operator.key} value={operator.key}>
                      {operator.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {operatorNeedsValue(condition.operator) ? (
                <Input
                  className="flex-1"
                  placeholder="Wert"
                  value={condition.value}
                  onChange={(event) => onChange(condition.id, { value: event.target.value })}
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

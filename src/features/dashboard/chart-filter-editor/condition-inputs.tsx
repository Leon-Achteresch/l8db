import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import { isDateType, isNumericType } from "@/lib/dashboards";
import { filterOperatorsForKind, operatorNeedsValue } from "@/lib/sql-filter";
import type { ChartFilterField } from "../chart-filter-editor";

export function ChartFilterConditionInputs({
  field,
  kind,
  operator,
  setOperator,
  value,
  setValue,
}: {
  field: ChartFilterField;
  kind: Parameters<typeof filterOperatorsForKind>[0];
  operator: string;
  setOperator: (value: string) => void;
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={operator} onValueChange={setOperator}>
        <SelectTrigger aria-label="Filterbedingung" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {filterOperatorsForKind(kind).map((op) => (
            <SelectItem key={op.key} value={op.key}>
              {op.key === "isNull"
                ? "hat keinen Wert"
                : op.key === "isNotNull"
                  ? "hat einen Wert"
                  : op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {operatorNeedsValue(operator) && (
        <FilterValueInput
          aria-label="Filterwert"
          operator={operator}
          value={value}
          onValueChange={setValue}
          type={
            isDateType(field.dataType)
              ? "date"
              : isNumericType(field.dataType) && !["in", "notIn"].includes(operator)
                ? "number"
                : "text"
          }
          placeholder={isNumericType(field.dataType) ? "z. B. 100" : "Wert eingeben"}
          className="h-8 min-w-40 flex-1 text-xs"
        />
      )}
    </div>
  );
}

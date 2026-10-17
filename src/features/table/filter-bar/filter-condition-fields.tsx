import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterOperatorSelect } from "@/features/filters/filter-operator-select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import type { DetailedColumnInfo } from "@/lib/db";
import { isDateFilterType, operatorNeedsValue } from "@/lib/sql-filter";
import type { FilterCondition } from "@/lib/table-view-state";

export function FilterConditionFields({
  condition,
  columns,
  columnDetails,
  focusValue,
  onChange,
  onSubmit,
}: {
  condition: FilterCondition;
  columns: string[];
  columnDetails?: DetailedColumnInfo[];
  focusValue?: boolean;
  onChange: (patch: Partial<FilterCondition>) => void;
  onSubmit: () => void;
}) {
  const type =
    columnDetails?.find((column) => column.name === condition.column)?.data_type ??
    condition.dataType;
  const date = isDateFilterType(type);
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Select
          value={condition.column}
          onValueChange={(column) => onChange({ column, dataType: undefined })}
        >
          <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Spalte">
            <SelectValue placeholder="Spalte wählen …" />
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
          onChange={(operator, value) => onChange({ operator, value })}
          size="sm"
          className="w-40"
          date={date}
        />
      </div>
      {operatorNeedsValue(condition.operator) ? (
        <FilterValueInput
          key={condition.operator}
          operator={condition.operator}
          value={condition.value}
          date={date}
          autoFocus={focusValue}
          aria-label="Wert"
          placeholder={type ? `Wert (${type})` : "Wert"}
          onValueChange={(value) => onChange({ value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className="h-8 w-full"
        />
      ) : null}
    </div>
  );
}

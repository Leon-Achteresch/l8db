import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import {
  isFilterActive,
  normalizeResultFilterOperator,
  type ResultFilterOperator,
  type ResultFilters,
  resultFilterOperatorLabel,
} from "@/lib/result-grid";
import { changeFilterOperator, OPERATORS, operatorNeedsValue } from "@/lib/sql-filter";
import { cn } from "@/lib/utils";

const FILTER_OPERATORS = OPERATORS.map((operator) => operator.key);

interface ResultFilterCellProps {
  col: string;
  filters: ResultFilters;
  translatedOperators: boolean;
  setFilter: (column: string, patch: Partial<ResultFilters[string]>) => void;
}

export function ResultFilterCell({
  col,
  filters,
  translatedOperators,
  setFilter,
}: ResultFilterCellProps) {
  const filter = filters[col] ?? {
    operator: "contains" as ResultFilterOperator,
    value: "",
  };
  const needsValue = operatorNeedsValue(normalizeResultFilterOperator(filter.operator));
  return (
    <th className="border-b border-r bg-muted/70 px-1 py-1">
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "h-6 shrink-0 px-1.5 text-[10px] font-normal",
                isFilterActive(filter) && "text-primary",
              )}
            >
              {resultFilterOperatorLabel(filter.operator, translatedOperators)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {FILTER_OPERATORS.map((operator) => (
              <DropdownMenuCheckboxItem
                key={operator}
                checked={normalizeResultFilterOperator(filter.operator) === operator}
                onCheckedChange={() =>
                  setFilter(col, {
                    operator,
                    value: changeFilterOperator(
                      filter.value,
                      normalizeResultFilterOperator(filter.operator),
                      operator,
                    ),
                  })
                }
              >
                {resultFilterOperatorLabel(operator, translatedOperators)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {needsValue && (
          <FilterValueInput
            key={filter.operator}
            operator={normalizeResultFilterOperator(filter.operator)}
            value={filter.value}
            onValueChange={(value) => setFilter(col, { value })}
            placeholder="Filter"
            aria-label={`Filter für ${col}`}
            className="h-6 min-w-0 flex-1 px-1.5 font-mono text-xs"
          />
        )}
      </div>
    </th>
  );
}

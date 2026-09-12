import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveConnection } from "@/lib/connections";
import { useSettingsStore } from "@/lib/settings";
import {
  changeFilterOperator,
  type FilterKind,
  filterOperatorLabel,
  filterOperatorsForKind,
} from "@/lib/sql-filter";

interface FilterOperatorSelectProps {
  operator: string;
  value: string;
  onChange: (operator: string, value: string) => void;
  className?: string;
  size?: "sm" | "default";
  kind?: FilterKind;
  operators?: { key: string; label: string }[];
}

export function FilterOperatorSelect({
  operator,
  value,
  onChange,
  className,
  size,
  kind: explicitKind,
  operators: customOperators,
}: FilterOperatorSelectProps) {
  const activeKind = useActiveConnection()?.kind;
  const kind = explicitKind === undefined ? activeKind : explicitKind;
  const translated = useSettingsStore((state) => state.translateFilterOperators);
  const operators = [
    ...new Map(
      (customOperators ?? filterOperatorsForKind(kind)).map((op) => [op.key, op]),
    ).values(),
  ];
  const supported = operators.some((op) => op.key === operator);
  return (
    <Select
      value={operator}
      onValueChange={(next) => onChange(next, changeFilterOperator(value, operator, next))}
    >
      <SelectTrigger size={size} className={className} aria-label="Filteroperator">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {!supported && (
          <SelectItem value={operator} disabled>
            {filterOperatorLabel(operator, translated, kind)} (nicht unterstützt)
          </SelectItem>
        )}
        {operators.map((op) => (
          <SelectItem key={op.key} value={op.key}>
            {translated ? op.label : filterOperatorLabel(op.key, false, kind)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

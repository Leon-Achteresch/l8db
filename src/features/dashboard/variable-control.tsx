import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type DashboardVariable, toLabel } from "@/lib/dashboards";
import { useDebounced, useSqlQuery } from "./use-dataset-query";

const ALL = "__l8_all__";

export function VariableControl({
  variable,
  value,
  onChange,
}: {
  variable: DashboardVariable;
  value: string;
  onChange: (value: string) => void;
}) {
  const query = useSqlQuery(
    useDebounced(variable.type === "select" ? (variable.optionsSql ?? "") : "", 500),
  );
  if (variable.type === "select") {
    const fromSql = (query.data?.rows ?? []).map((row) => {
      const first = query.data?.columns[0];
      return first ? toLabel(row[first]) : "";
    });
    const options = [...new Set([...(variable.options ?? []), ...fromSql])].filter(Boolean);
    return (
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger
          size="sm"
          aria-label={variable.label}
          className="h-7 min-w-24 border-0 bg-transparent px-1.5 text-xs font-medium shadow-none dark:bg-transparent"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent searchable={options.length > 8}>
          <SelectItem value={ALL}>Alle</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      aria-label={variable.label}
      type={variable.type === "number" ? "number" : variable.type === "date" ? "date" : "text"}
      value={value}
      placeholder="Alle"
      onChange={(event) => onChange(event.target.value)}
      className={`h-7 ${variable.type === "number" ? "w-16" : "w-28"} border-0 bg-transparent px-1.5 text-xs font-medium shadow-none focus-visible:ring-1 dark:bg-transparent`}
    />
  );
}

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildSimpleSql,
  type DashboardVariable,
  emptySimple,
  toLabel,
  type VariableColumn,
  variableList,
} from "@/lib/dashboards";
import type { DatabaseKind } from "@/lib/db";
import { useDebounced, useSqlQuery } from "./use-dataset-query";
import { useSqlDialect } from "./use-sql-dialect";
import { VariableMultiSelect } from "./variable-multi-select";

const ALL = "__l8_all__";
const OPTION_LIMIT = 500;

function columnOptionsSql(bound: VariableColumn, kind: DatabaseKind | null): string {
  if (!bound.table || !bound.column) return "";
  return buildSimpleSql(
    {
      ...emptySimple(),
      schema: bound.schema,
      table: bound.table,
      dimension: { column: bound.column, bucket: "none" },
      metrics: [{ id: "count", agg: "count", column: null, label: "" }],
      sort: "dimension",
      limit: OPTION_LIMIT,
    },
    kind,
  );
}

export function VariableControl({
  variable,
  value,
  onChange,
}: {
  variable: DashboardVariable;
  value: string;
  onChange: (value: string) => void;
}) {
  const kind = useSqlDialect();
  const optionsSql =
    variable.type !== "select"
      ? ""
      : variable.column
        ? columnOptionsSql(variable.column, kind)
        : (variable.optionsSql ?? "");
  const query = useSqlQuery(useDebounced(optionsSql, 500));
  if (variable.type === "select") {
    const first = query.data?.columns[0];
    const fromSql = (query.data?.rows ?? []).flatMap((row) => {
      const cell = first ? row[first] : null;
      return cell === null || cell === undefined ? [] : [toLabel(cell)];
    });
    const options = [...new Set([...(variable.options ?? []), ...fromSql])].filter(Boolean);
    if (variable.multiple)
      return (
        <VariableMultiSelect
          label={variable.label}
          options={options}
          value={variableList(variable, value)}
          onChange={(next) => onChange(next.length ? JSON.stringify(next) : "")}
        />
      );
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

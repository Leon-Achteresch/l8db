import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterValueInput } from "@/features/filters/filter-value-input";
import type { WorksheetField } from "@/lib/chart-worksheet";
import { queryErrorMessage } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import {
  buildSimpleSql,
  createId,
  type DatasetFilter,
  isDateType,
  isNumericType,
  type SimpleDataset,
  toLabel,
} from "@/lib/dashboards";
import { filterOperatorsForKind, operatorNeedsValue, parseFilterList } from "@/lib/sql-filter";
import { useSqlQuery } from "./use-dataset-query";

export function WorksheetFilterEditor({
  field,
  simple,
  filter,
  onApply,
  onCancel,
}: {
  field: WorksheetField;
  simple: SimpleDataset;
  filter?: DatasetFilter;
  onApply: (filters: DatasetFilter[]) => void;
  onCancel: () => void;
}) {
  const connection = useActiveConnection();
  const categorical = !isNumericType(field.dataType) && !isDateType(field.dataType);
  const [mode, setMode] = useState(
    filter?.rangeId || (!filter && !categorical)
      ? "range"
      : categorical && (!filter || ["in", "notIn"].includes(filter.operator))
        ? "values"
        : "condition",
  );
  const rangeFilters = filter?.rangeId
    ? simple.filters.filter((f) => f.rangeId === filter.rangeId)
    : [];
  const [lower, setLower] = useState(rangeFilters.find((f) => f.operator === "gte")?.value ?? "");
  const [upper, setUpper] = useState(rangeFilters.find((f) => f.operator === "lte")?.value ?? "");
  const [value, setValue] = useState(filter?.value ?? "");
  const [operator, setOperator] = useState(filter?.operator ?? (categorical ? "in" : "gte"));
  const [search, setSearch] = useState("");
  const chosen = parseFilterList(value);
  const sql =
    mode === "values"
      ? buildSimpleSql(
          {
            ...simple,
            dimension: { column: field.ref, bucket: "none" },
            dimension2: null,
            metrics: [{ id: "count", agg: "count", column: null, label: "" }],
            filters: [],
            dateColumn: null,
            sort: "dimension",
            limit: 100,
          },
          connection?.kind ?? null,
        )
      : "";
  const query = useSqlQuery(sql);
  const values = [
    ...new Set(
      (query.data?.rows ?? [])
        .map((r) => r.dim)
        .filter((v) => v !== null && v !== undefined)
        .map(String),
    ),
  ];
  const boundsValid =
    !lower ||
    !upper ||
    (isNumericType(field.dataType) ? Number(lower) <= Number(upper) : lower <= upper);
  const valid =
    mode === "range"
      ? Boolean(lower || upper) && boundsValid
      : mode === "values"
        ? chosen.length > 0
        : !operatorNeedsValue(operator) || value.trim().length > 0;
  const apply = () => {
    if (mode === "range") {
      const rangeId = filter?.rangeId ?? createId();
      onApply([
        ...(lower
          ? [
              {
                id: `${rangeId}:from`,
                rangeId,
                column: field.ref,
                operator: "gte",
                value: lower,
                dataType: field.dataType,
              },
            ]
          : []),
        ...(upper
          ? [
              {
                id: `${rangeId}:to`,
                rangeId,
                column: field.ref,
                operator: "lte",
                value: upper,
                dataType: field.dataType,
              },
            ]
          : []),
      ]);
    } else
      onApply([
        {
          id: filter?.id ?? createId(),
          column: field.ref,
          operator,
          value,
          dataType: field.dataType,
        },
      ]);
  };
  return (
    <section
      aria-label={`Filter für ${field.label}`}
      className="space-y-3 rounded-lg border border-primary/30 bg-card p-4 shadow-sm"
    >
      <div>
        <h3 className="text-sm font-semibold">Welche {field.label}-Werte möchtest du zeigen?</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Dieser Filter gilt nur für diesen Chart. Die Originaldaten bleiben unverändert.
        </p>
      </div>
      {categorical && (
        <div className="flex gap-2">
          <Button
            size="xs"
            variant={mode === "values" ? "secondary" : "ghost"}
            onClick={() => {
              setMode("values");
              setOperator("in");
              setValue("[]");
            }}
          >
            Werte auswählen
          </Button>
          <Button
            size="xs"
            variant={mode === "condition" ? "secondary" : "ghost"}
            onClick={() => {
              setMode("condition");
              setOperator("contains");
              setValue("");
            }}
          >
            Bedingung festlegen
          </Button>
        </div>
      )}
      {!categorical && (
        <div className="flex gap-2">
          <Button
            size="xs"
            variant={mode === "range" ? "secondary" : "ghost"}
            onClick={() => setMode("range")}
          >
            Bereich wählen
          </Button>
          <Button
            size="xs"
            variant={mode === "condition" ? "secondary" : "ghost"}
            onClick={() => setMode("condition")}
          >
            Bedingung festlegen
          </Button>
        </div>
      )}
      {mode === "range" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="range-from" className="space-y-1 text-xs">
              <span>Von (einschließlich)</span>
              <Input
                id="range-from"
                aria-label="Filter von"
                type={isDateType(field.dataType) ? "date" : "number"}
                value={lower}
                onChange={(e) => setLower(e.target.value)}
                placeholder="Keine Untergrenze"
              />
            </label>
            <label htmlFor="range-to" className="space-y-1 text-xs">
              <span>Bis (einschließlich)</span>
              <Input
                id="range-to"
                aria-label="Filter bis"
                type={isDateType(field.dataType) ? "date" : "number"}
                value={upper}
                onChange={(e) => setUpper(e.target.value)}
                placeholder="Keine Obergrenze"
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Du kannst eine Grenze frei lassen. Gefiltert werden die einzelnen Datensätze, bevor ihre
            Werte zusammengefasst werden.
          </p>
          {!boundsValid && (
            <p role="alert" className="text-xs text-destructive">
              Die Untergrenze muss kleiner oder gleich der Obergrenze sein.
            </p>
          )}
        </div>
      ) : mode === "values" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Select value={operator === "notIn" ? "notIn" : "in"} onValueChange={setOperator}>
              <SelectTrigger aria-label="Werte ein- oder ausschließen" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Nur ausgewählte Werte zeigen</SelectItem>
                <SelectItem value="notIn">Ausgewählte Werte ausschließen</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label="Filterwerte suchen"
              className="h-8 flex-1 text-xs"
              placeholder="Werte suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {query.isFetching && (
            <p role="status" className="text-xs text-muted-foreground">
              Verfügbare Werte werden geladen…
            </p>
          )}
          {query.isError && (
            <p role="alert" className="text-xs text-destructive">
              {queryErrorMessage(query.error)} · Du kannst stattdessen eine Bedingung festlegen.
            </p>
          )}
          <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto">
            {[...new Set([...chosen, ...values])]
              .filter((v) => v.toLowerCase().includes(search.toLowerCase()))
              .map((v) => (
                <label
                  key={v}
                  htmlFor={`filter-value-${encodeURIComponent(field.ref)}-${encodeURIComponent(v)}`}
                  className="flex min-w-0 items-center gap-2 rounded p-1 text-xs hover:bg-muted"
                >
                  <Checkbox
                    id={`filter-value-${encodeURIComponent(field.ref)}-${encodeURIComponent(v)}`}
                    checked={chosen.includes(v)}
                    onCheckedChange={(checked) =>
                      setValue(
                        JSON.stringify(checked ? [...chosen, v] : chosen.filter((x) => x !== v)),
                      )
                    }
                  />
                  <span className="truncate">{toLabel(v) || "(leerer Text)"}</span>
                </label>
              ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {chosen.length} ausgewählt · Bis zu 100 Werte werden angeboten. Weitere Werte lassen
            sich über eine Bedingung eingeben.
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={operator} onValueChange={setOperator}>
            <SelectTrigger aria-label="Filterbedingung" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filterOperatorsForKind(connection?.kind).map((op) => (
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
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button size="sm" disabled={!valid} onClick={apply}>
          Filter anwenden
        </Button>
      </div>
    </section>
  );
}

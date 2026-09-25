import { ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHART_ICONS } from "@/features/dashboard/chart-palette";
import { ColumnSelect } from "@/features/dashboard/dataset-column-select";
import { CHARTS, type ChartKind } from "@/lib/dashboards";
import {
  type ColumnRole,
  RESULT_AGG_LABEL,
  RESULT_SORT_LABEL,
  type ResultAgg,
  type ResultChartConfig,
  type ResultSort,
} from "@/lib/result-chart";

const ROLE_LABEL: Record<ColumnRole, string> = { number: "Zahl", date: "Datum", text: "Text" };

export function ResultChartSettings({
  config,
  roles,
  onChange,
}: {
  config: ResultChartConfig;
  roles: Record<string, ColumnRole>;
  onChange: (patch: Partial<ResultChartConfig>) => void;
}) {
  const columns = useMemo(
    () =>
      Object.entries(roles).map(([name, role]) => ({
        ref: name,
        label: name,
        type: ROLE_LABEL[role],
      })),
    [roles],
  );
  const scatter = config.chart === "scatter";
  const yLabel = config.y.length ? config.y.join(", ") : "Keine";
  return (
    <div className="flex shrink-0 flex-wrap items-end gap-2 border-b px-3 py-2">
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        Diagrammtyp
        <Select
          value={config.chart}
          onValueChange={(chart) => onChange({ chart: chart as ChartKind })}
        >
          <SelectTrigger size="sm" aria-label="Diagrammtyp" className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHARTS) as ChartKind[]).map((kind) => {
              const Icon = CHART_ICONS[kind];
              return (
                <SelectItem key={kind} value={kind}>
                  <Icon className="size-3.5" />
                  {CHARTS[kind].label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        {scatter ? "X (Zahl)" : "X / Kategorie"}
        <ColumnSelect
          label="X-Spalte"
          value={config.x}
          onChange={(x) => onChange({ x })}
          columns={columns}
          allowNone="Keine"
          className="w-40"
        />
      </div>
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        {scatter ? "Y / Größe" : "Y-Werte"}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label="Y-Spalten"
              className="h-8 w-44 justify-between text-xs font-normal"
            >
              <span className="truncate">{yLabel}</span>
              <ChevronDownIcon className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
            {columns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.ref}
                checked={config.y.includes(column.ref)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  onChange({
                    y: checked
                      ? [...config.y, column.ref]
                      : config.y.filter((c) => c !== column.ref),
                  })
                }
              >
                <span className="truncate">{column.label}</span>
                <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground">
                  {column.type}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        {scatter ? "Farbe" : "Serie"}
        <ColumnSelect
          label="Serien-Spalte"
          value={config.series}
          onChange={(series) => onChange({ series })}
          columns={columns}
          allowNone="Keine"
          className="w-36"
        />
      </div>
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        Aggregation
        <Select value={config.agg} onValueChange={(agg) => onChange({ agg: agg as ResultAgg })}>
          <SelectTrigger size="sm" aria-label="Aggregation" className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RESULT_AGG_LABEL) as ResultAgg[]).map((agg) => (
              <SelectItem key={agg} value={agg}>
                {RESULT_AGG_LABEL[agg]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        Sortierung
        <Select
          value={config.sort}
          onValueChange={(sort) => onChange({ sort: sort as ResultSort })}
        >
          <SelectTrigger size="sm" aria-label="Sortierung" className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RESULT_SORT_LABEL) as ResultSort[]).map((sort) => (
              <SelectItem key={sort} value={sort}>
                {RESULT_SORT_LABEL[sort]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        Top N
        <Input
          type="number"
          min={1}
          aria-label="Top N"
          placeholder="Alle"
          className="h-8 w-20 text-xs"
          value={config.topN ?? ""}
          onChange={(event) => {
            const value = Number(event.target.value);
            onChange({ topN: event.target.value && value > 0 ? Math.floor(value) : null });
          }}
        />
      </div>
    </div>
  );
}

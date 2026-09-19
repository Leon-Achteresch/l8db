import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AGG_LABEL,
  type Agg,
  CHARTS,
  type ChartKind,
  chartFits,
  type Dataset,
  type DatasetShape,
  emptySimple,
  isDateType,
  isNumericType,
  joinRef,
  type Widget,
} from "@/lib/dashboards";
import { useDetailedColumnsQuery, useTablesQuery, useViewsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CHART_ICONS } from "./chart-palette";
import { ColumnSelect } from "./dataset-column-select";

const QUICK_KINDS: ChartKind[] = ["kpi", "column", "line", "donut", "bars", "table"];

export function ChartQuickForm({
  dataset,
  widget,
  shape,
  titlePlaceholder,
  onDataset,
  onWidget,
}: {
  dataset: Dataset;
  widget: Widget;
  shape: DatasetShape;
  titlePlaceholder: string;
  onDataset: (patch: Partial<Dataset>) => void;
  onWidget: (patch: Partial<Widget>) => void;
}) {
  const s = dataset.simple;
  const tables = useTablesQuery();
  const views = useViewsQuery();
  const base = useDetailedColumnsQuery(s.schema, s.table);
  const joined = useDetailedColumnsQuery(s.join?.schema ?? "", s.join?.table ?? "");
  const sources = [
    ...(tables.data ?? []).map((t) => ({ ...t, kind: "Tabelle" })),
    ...(views.data ?? []).map((v) => ({ ...v, kind: "View" })),
  ];
  const columns = useMemo(
    () => [
      ...(base.data ?? []).map((c) => ({ ref: c.name, label: c.name, type: c.data_type })),
      ...(s.join
        ? (joined.data ?? []).map((c) => ({
            ref: joinRef(c.name),
            label: `${s.join?.table}.${c.name}`,
            type: c.data_type,
          }))
        : []),
    ],
    [base.data, joined.data, s.join],
  );
  const typeOf = (ref: string | null | undefined) => columns.find((c) => c.ref === ref)?.type ?? "";
  const metric = s.metrics[0];
  const metricValue = metric.agg === "count" ? "count" : `${metric.agg}:${metric.column ?? ""}`;
  const numeric = columns.filter((c) => isNumericType(c.type));
  const metricOptions = [
    { value: "count", label: "Anzahl Zeilen" },
    ...numeric.flatMap((c) => [
      { value: `sum:${c.ref}`, label: `Summe von ${c.label}` },
      { value: `avg:${c.ref}`, label: `Durchschnitt von ${c.label}` },
    ]),
  ];
  if (!metricOptions.some((o) => o.value === metricValue))
    metricOptions.push({
      value: metricValue,
      label: `${AGG_LABEL[metric.agg]}${metric.column ? ` von ${metric.column}` : ""}`,
    });
  const kinds = QUICK_KINDS.includes(widget.chart) ? QUICK_KINDS : [...QUICK_KINDS, widget.chart];
  const sourceKey = s.table ? JSON.stringify([s.schema, s.table]) : "";

  if (dataset.mode === "expert")
    return (
      <div className="rounded-xl border bg-card/60 p-4 text-xs leading-relaxed text-muted-foreground">
        Dieser Chart nutzt eine eigene SQL-Abfrage. Du bearbeitest ihn unter{" "}
        <span className="font-medium text-foreground">Erweitert</span>.
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Daten aus</p>
        <Select
          value={sourceKey}
          onValueChange={(v) => {
            const [schema, table] = JSON.parse(v) as [string, string];
            onDataset({ simple: { ...emptySimple(), schema, table } });
          }}
        >
          <SelectTrigger size="sm" className="h-9 w-full text-sm" aria-label="Datenquelle">
            <SelectValue placeholder="Tabelle oder View wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            {sources.map((src) => (
              <SelectItem
                key={`${src.kind}:${src.schema}.${src.name}`}
                value={JSON.stringify([src.schema, src.name])}
              >
                <span className="truncate">{src.name}</span>
                <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{src.kind}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className={cn("space-y-5", !s.table && "pointer-events-none opacity-40")}>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Was möchtest du sehen?</p>
          <Select
            value={metricValue}
            onValueChange={(v) => {
              const [agg, column] = v === "count" ? ["count", null] : v.split(/:(.*)/s);
              onDataset({
                simple: {
                  ...s,
                  metrics: [
                    { ...metric, agg: agg as Agg, column: column || null, label: "" },
                    ...s.metrics.slice(1),
                  ],
                },
              });
            }}
          >
            <SelectTrigger size="sm" className="h-9 w-full text-sm" aria-label="Kennzahl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent searchable>
              {metricOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {s.metrics.length > 1 && (
            <p className="text-[11px] text-muted-foreground">
              + {s.metrics.length - 1} weitere Kennzahl(en) unter Erweitert
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium">Aufgeteilt nach</p>
          <ColumnSelect
            value={s.dimension?.column ?? null}
            onChange={(column) => {
              const isDate = Boolean(column) && isDateType(typeOf(column));
              onDataset({
                simple: {
                  ...s,
                  dimension: column ? { column, bucket: isDate ? "month" : "none" } : null,
                  dateColumn: isDate && !s.dateColumn ? column : s.dateColumn,
                  sort: isDate ? "dimension" : column ? "metric_desc" : s.sort,
                },
              });
            }}
            columns={columns}
            allowNone="Nichts, nur eine Zahl"
            label="Aufteilung"
            className="h-9 text-sm"
          />
          {s.dimension && isDateType(typeOf(s.dimension.column)) && (
            <p className="text-[11px] text-muted-foreground">
              Datumswerte werden pro Monat zusammengefasst. Ändern unter Erweitert.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium">Darstellung</p>
          <div className="grid grid-cols-3 gap-2">
            {kinds.map((kind) => {
              const Icon = CHART_ICONS[kind];
              const problem = chartFits(kind, shape);
              const active = kind === widget.chart;
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={Boolean(problem) && !active}
                  aria-pressed={active}
                  title={problem ?? CHARTS[kind].hint}
                  onClick={() => onWidget({ chart: kind })}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    active ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
                    problem && !active && "opacity-40",
                  )}
                >
                  <Icon className="size-4 text-primary" />
                  {CHARTS[kind].label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium">Titel</p>
          <Input
            aria-label="Chart-Titel"
            value={widget.title}
            placeholder={titlePlaceholder}
            onChange={(e) => onWidget({ title: e.target.value })}
            className="h-9 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

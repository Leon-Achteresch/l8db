import {
  CHARTS,
  type ChartKind,
  createId,
  type Dashboard,
  type Dataset,
  type DatasetFilter,
  type DatasetMetric,
  type DatasetShape,
  emptyDataset,
  isDateType,
  isNumericType,
  type SimpleDataset,
  settle,
  toLabel,
  toNumber,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";

export const FIELD_MIME = "application/x-l8db-worksheet-field";
export const ROW_COUNT_FIELD = "__l8db_row_count__";
export type ShelfId = "columns" | "rows" | "color" | "size" | "filters";
export interface WorksheetField {
  ref: string;
  label: string;
  dataType: string;
}
export interface FieldPlacement {
  fieldRef: string;
  chartId: string;
  metricId?: string;
  from?: ShelfId;
}
export interface WorksheetSnapshot {
  dataset: Dataset;
  widget: Widget;
}

export function shelfRole(
  chart: ChartKind,
  shelf: ShelfId,
  horizontal = false,
): "dimension" | "dimension2" | "metric" | "filter" | null {
  if (shelf === "filters") return "filter";
  if (chart === "scatter") return shelf === "color" ? "dimension" : "metric";
  if (chart === "sankey" || chart === "heatmap") {
    if (shelf === "columns") return "dimension";
    if (shelf === "rows") return "dimension2";
    return (chart === "sankey" && shelf === "size") || (chart === "heatmap" && shelf === "color")
      ? "metric"
      : null;
  }
  if (shelf === "color")
    return ["column", "line", "area", "radar"].includes(chart) ? "dimension2" : null;
  if (shelf === "size") return null;
  const dimensionShelf = chart === "column" && horizontal ? "rows" : "columns";
  return shelf === dimensionShelf ? "dimension" : "metric";
}

export function worksheetShelves(widget: Widget): { id: ShelfId; label: string; hint: string }[] {
  const horizontal = widgetOptions(widget).horizontal;
  if (widget.chart === "scatter")
    return [
      { id: "columns", label: "Spalten · X", hint: "Zahlenfeld für die X-Achse" },
      { id: "rows", label: "Zeilen · Y", hint: "Zahlenfeld für die Y-Achse" },
      { id: "color", label: "Farbe", hint: "Kategorie zum Einfärben" },
      { id: "size", label: "Größe", hint: "Zahlenfeld für die Blasengröße" },
    ];
  if (widget.chart === "sankey" || widget.chart === "heatmap")
    return [
      {
        id: "columns",
        label: widget.chart === "sankey" ? "Quelle" : "Spalten",
        hint: "Erste Kategorie hier ablegen",
      },
      {
        id: "rows",
        label: widget.chart === "sankey" ? "Ziel" : "Zeilen",
        hint: "Zweite Kategorie hier ablegen",
      },
      {
        id: widget.chart === "sankey" ? "size" : "color",
        label: widget.chart === "sankey" ? "Menge" : "Farbintensität",
        hint: "Kennzahl hier ablegen",
      },
    ];
  return [
    {
      id: "columns",
      label: "Spalten",
      hint:
        horizontal && widget.chart === "column"
          ? "Kennzahlen hier ablegen"
          : "Kategorie oder Datum hier ablegen",
    },
    {
      id: "rows",
      label: "Zeilen",
      hint:
        horizontal && widget.chart === "column"
          ? "Kategorie oder Datum hier ablegen"
          : "Kennzahlen hier ablegen",
    },
    ...(["column", "line", "area", "radar"].includes(widget.chart)
      ? [
          {
            id: "color" as const,
            label: "Farbe",
            hint: "Optional: nach einer weiteren Kategorie aufteilen",
          },
        ]
      : []),
  ];
}

export function newWorksheet(dashboard: Dashboard, chart: ChartKind): WorksheetSnapshot {
  const dataset = emptyDataset(`Chart ${dashboard.widgets.length + 1}`);
  const previous = dashboard.datasets.find((d) => d.mode === "simple" && d.simple.table);
  dataset.simple = {
    ...dataset.simple,
    schema: previous?.simple.schema ?? "",
    table: previous?.simple.table ?? "",
    metrics: [],
    limit: 500,
  };
  const widget = settle(
    {
      id: createId(),
      chart,
      datasetId: dataset.id,
      title: `Chart ${dashboard.widgets.length + 1}`,
      period: "all",
      x: 0,
      y: 0,
      w: CHARTS[chart].w,
      h: CHARTS[chart].h,
      options: { showValue: false, showDelta: false, stacked: false, showPeriod: false },
    },
    dashboard.widgets,
  );
  return { dataset, widget };
}

export function updateWorksheet(
  dashboard: Dashboard,
  widgetId: string,
  snapshot: WorksheetSnapshot,
): Partial<Dashboard> {
  const current = dashboard.widgets.find((w) => w.id === widgetId);
  if (!current) return {};
  const shared = dashboard.widgets.some(
    (w) => w.id !== widgetId && w.datasetId === current.datasetId,
  );
  const exists = dashboard.datasets.some((d) => d.id === current.datasetId);
  const dataset = {
    ...snapshot.dataset,
    id: shared || !exists ? createId() : (current.datasetId as string),
  };
  return {
    datasets:
      shared || !exists
        ? [...dashboard.datasets, dataset]
        : dashboard.datasets.map((d) => (d.id === dataset.id ? dataset : d)),
    widgets: dashboard.widgets.map((w) =>
      w.id === widgetId ? { ...snapshot.widget, id: widgetId, datasetId: dataset.id } : w,
    ),
  };
}

export function placeField(
  snapshot: WorksheetSnapshot,
  field: WorksheetField,
  shelf: ShelfId,
  placement?: FieldPlacement,
): WorksheetSnapshot {
  const dataset = structuredClone(snapshot.dataset);
  const widget = structuredClone(snapshot.widget);
  const s = dataset.simple;
  let horizontal = widgetOptions(widget).horizontal;
  const numeric = isNumericType(field.dataType) || field.ref === ROW_COUNT_FIELD;
  if (widget.chart === "column" && (shelf === "rows" || shelf === "columns")) {
    horizontal = numeric ? shelf === "columns" : shelf === "rows";
    widget.options = { ...widget.options, horizontal };
  }
  const role = shelfRole(widget.chart, shelf, horizontal);
  if (!role || role === "filter") return snapshot;
  if (role === "dimension" || role === "dimension2") {
    if (field.ref === ROW_COUNT_FIELD) return snapshot;
    if (role === "dimension") {
      s.dimension = { column: field.ref, bucket: isDateType(field.dataType) ? "month" : "none" };
      if (isDateType(field.dataType)) s.dateColumn = field.ref;
    } else s.dimension2 = field.ref;
    if (placement?.from && placement.from !== shelf && placement.from !== "filters") {
      const previous = shelfRole(
        widget.chart,
        placement.from,
        widgetOptions(snapshot.widget).horizontal,
      );
      if (previous === "dimension" && role !== "dimension") s.dimension = null;
      if (previous === "dimension2" && role !== "dimension2") s.dimension2 = null;
    }
  } else {
    const oldMetric = placement?.metricId
      ? s.metrics.find((m) => m.id === placement.metricId)
      : null;
    const metric: DatasetMetric = oldMetric ?? {
      id: createId(),
      column: field.ref === ROW_COUNT_FIELD ? null : field.ref,
      agg:
        field.ref === ROW_COUNT_FIELD
          ? "count"
          : numeric
            ? widget.chart === "scatter"
              ? "avg"
              : "sum"
            : "count_distinct",
      label: "",
    };
    if (widget.chart === "scatter") {
      const position = shelf === "columns" ? 0 : shelf === "rows" ? 1 : 2;
      if (!numeric) return snapshot;
      while (s.metrics.length <= position)
        s.metrics.push({ id: createId(), column: null, agg: "avg", label: "" });
      if (oldMetric) {
        const oldIndex = s.metrics.findIndex((m) => m.id === oldMetric.id);
        const replaced = s.metrics[position];
        s.metrics[oldIndex] = replaced;
      }
      s.metrics[position] = metric;
    } else {
      const remaining = s.metrics.filter((m) => m.id !== metric.id);
      const max = CHARTS[widget.chart].metrics[1];
      s.metrics = max === 1 ? [metric] : [...remaining, metric].slice(-max);
    }
    widget.options = { ...widget.options, metricKeys: null };
  }
  return { dataset, widget };
}

export function fieldPlacement(
  data: string,
  chartId: string,
  fields: WorksheetField[],
): { placement: FieldPlacement; field: WorksheetField } | null {
  try {
    const placement = JSON.parse(data) as FieldPlacement;
    if (placement.chartId !== chartId || typeof placement.fieldRef !== "string") return null;
    const field = fields.find((f) => f.ref === placement.fieldRef);
    return field ? { placement, field } : null;
  } catch {
    return null;
  }
}

export function colorSeries(
  kind: ChartKind,
  shape: DatasetShape,
  rows: Record<string, unknown>[],
): { shape: DatasetShape; rows: Record<string, unknown>[] } {
  if (!shape.dimension2 || !["column", "line", "area", "radar"].includes(kind))
    return { shape, rows };
  const groups = [...new Set(rows.map((r) => toLabel(r[shape.dimension2 as string])))];
  const metrics = groups.flatMap((group, index) =>
    shape.metrics.map((metric, m) => ({
      key: `series_${index}_${m}`,
      label: shape.metrics.length > 1 ? `${group} · ${metric.label}` : group,
    })),
  );
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const dim = shape.dimension ? row[shape.dimension] : "Gesamt";
    const key = JSON.stringify(dim);
    const target = result.get(key) ?? { [shape.dimension ?? "dim"]: dim };
    const group = groups.indexOf(toLabel(row[shape.dimension2]));
    shape.metrics.forEach((m, i) => {
      const k = `series_${group}_${i}`;
      target[k] = toNumber(target[k]) + toNumber(row[m.key]);
    });
    result.set(key, target);
  }
  return { shape: { ...shape, dimension2: null, metrics }, rows: [...result.values()] };
}

export function emptySource(simple: SimpleDataset, schema: string, table: string): SimpleDataset {
  return {
    ...simple,
    schema,
    table,
    join: null,
    dimension: null,
    dimension2: null,
    metrics: [],
    filters: [],
    dateColumn: null,
  };
}

export function worksheetFilterGroups(filters: DatasetFilter[]): DatasetFilter[][] {
  const groups = new Map<string, DatasetFilter[]>();
  for (const filter of filters) {
    const key = filter.rangeId ? `range:${filter.rangeId}` : `filter:${filter.id}`;
    groups.set(key, [...(groups.get(key) ?? []), filter]);
  }
  return [...groups.values()];
}

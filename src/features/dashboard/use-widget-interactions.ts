import { useQueryClient } from "@tanstack/react-query";
import type { KeyboardEvent, MouseEvent } from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import {
  applyCrossFilters,
  CALC_PREFIX,
  type CrossCondition,
  type CrossFilter,
  crossField,
  type Dataset,
  DIM_KEY,
  DIM2_KEY,
  datasetDetailSql,
  datasetShape,
  ownCondition,
  type Period,
  parseRef,
  refLabel,
  toLabel,
  useCrossFilterStore,
  useCrossFilters,
  type Widget,
  type WidgetOptions,
} from "@/lib/dashboards";
import { exportRowsCsv } from "@/lib/dashboards/csv";
import type { QueryResult } from "@/lib/db";
import { applyMasks, resolveMasks } from "@/lib/masking";
import { connectionMaskRules, useMaskingDisplay } from "@/lib/masking-display";
import { loadMcpConfig } from "@/lib/mcp";
import type { ChartPoint } from "./chart-point-menu";
import { useDashboardInteraction } from "./dashboard-interaction";
import { useDashboardScope } from "./dashboard-scope";
import { useWidgetDetailsStore } from "./widget-details-store";

interface Pick {
  key: string;
  value: unknown;
}

function parseAttr(value: string | null): unknown {
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function fieldLabel(dataset: Dataset, key: string): string {
  if (dataset.mode === "expert")
    return (key === DIM2_KEY ? dataset.mapping.dimension2 : dataset.mapping.dimension) ?? "";
  const ref = key === DIM2_KEY ? dataset.simple.dimension2 : dataset.simple.dimension?.column;
  return ref ? refLabel(ref, dataset.simple) : "";
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} (${count})`;
  });
}

function sourceColumn(dataset: Dataset, key: string): string | null {
  return crossField(dataset, key)?.column ?? (fieldLabel(dataset, key) || null);
}

const COUNTING_AGGS = new Set(["count", "count_distinct"]);

function metricSource(dataset: Dataset, index: number): string | null {
  if (dataset.mode === "expert") return dataset.mapping.metrics[index] ?? null;
  const metric = dataset.simple.metrics.filter((m) => m.agg === "count" || m.column)[index];
  if (!metric?.column || COUNTING_AGGS.has(metric.agg)) return null;
  if (metric.column.startsWith(CALC_PREFIX)) return refLabel(metric.column, dataset.simple);
  return parseRef(metric.column, dataset.simple).column;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useWidgetInteractions({
  widget,
  dataset,
  options,
  period,
  title,
}: {
  widget: Widget;
  dataset: Dataset | null;
  options: WidgetOptions;
  period: Period;
  title: string;
}) {
  const interaction = useDashboardInteraction();
  const dashboardId = interaction?.dashboardId ?? null;
  const filters = useCrossFilters(dashboardId);
  const connection = useActiveConnection();
  const scope = useDashboardScope();
  const queryClient = useQueryClient();
  const scopeId = useId();
  const [point, setPoint] = useState<(ChartPoint & { picks: Pick[] }) | null>(null);
  const effective = useMemo(
    () =>
      dataset ? applyCrossFilters(dataset, filters, widget.id, connection?.kind ?? null) : null,
    [dataset, filters, widget.id, connection?.kind],
  );
  const own = useMemo(() => filters.filter((f) => f.widgetId === widget.id), [filters, widget.id]);
  const kind = connection?.kind ?? null;

  const openDetails = useCallback(
    (conditions: CrossCondition[], subtitle: string) => {
      if (!effective) return;
      const sql = datasetDetailSql(effective, conditions, kind, period, scope);
      if (!sql) return;
      useWidgetDetailsStore.getState().open({ title, subtitle, sql });
    },
    [effective, kind, period, scope, title],
  );

  const openPoint = (
    target: Element,
    container: HTMLElement,
    at: { x: number; y: number } | null,
  ): boolean => {
    if (!dashboardId || !dataset || (!options.crossFilter && !options.drill)) return false;
    const dim = parseAttr(
      target.getAttribute("data-dim") ?? target.getAttribute("data-active-dim"),
    );
    const dim2 = parseAttr(target.getAttribute("data-dim2"));
    const scalar = (value: unknown) => value === null || typeof value !== "object";
    const clicked: Pick[] = [
      ...(dim !== undefined ? [{ key: DIM_KEY, value: dim }] : []),
      ...(dim2 !== undefined ? [{ key: DIM2_KEY, value: dim2 }] : []),
    ];
    const picks = clicked.filter((p) => scalar(p.value));
    if (!picks.length) return false;
    const canFilter = options.crossFilter && picks.some((p) => crossField(dataset, p.key));
    const canDrill =
      options.drill &&
      picks.length === clicked.length &&
      picks.some((p) => ownCondition(dataset, p.key, p.value));
    if (!canFilter && !canDrill) return false;
    const root = container.closest(".dashboard-widget") ?? container;
    const rect = root.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const point = at ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    setPoint({
      x: point.x - rect.left,
      y: point.y - rect.top,
      label: clicked.map((p) => toLabel(p.value)).join(" × "),
      filtered: picks.every((p) => own.some((f) => f.key === p.key && same(f.value, p.value))),
      canFilter,
      canDrill,
      picks,
    });
    return true;
  };

  const onContentClick = (event: MouseEvent<HTMLElement>) => {
    const target = (event.target as Element).closest("[data-dim], [data-dim2], [data-active-dim]");
    if (!target) return;
    const keyboard = event.detail === 0;
    openPoint(
      target,
      event.currentTarget,
      keyboard ? null : { x: event.clientX, y: event.clientY },
    );
  };

  const onContentKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = (event.target as Element).closest("[data-dim], [data-dim2]");
    if (target && openPoint(target, event.currentTarget, null)) event.preventDefault();
  };

  const filterPoint = () => {
    if (!point || !dashboardId || !dataset) return;
    const next: CrossFilter[] = [];
    for (const p of point.picks) {
      const field = crossField(dataset, p.key);
      if (!field) continue;
      next.push({
        widgetId: widget.id,
        key: p.key,
        field,
        value: p.value,
        label: `${fieldLabel(dataset, p.key) || title}: ${toLabel(p.value)}`,
      });
    }
    if (next.length) useCrossFilterStore.getState().select(dashboardId, next);
  };

  const detailsPoint = () => {
    if (!point || !effective) return;
    const conditions = point.picks
      .map((p) => ownCondition(effective, p.key, p.value))
      .filter((c): c is CrossCondition => c !== null);
    openDetails(conditions, point.label);
  };

  const exportCsv = async (result: QueryResult | undefined) => {
    if (!result || !effective) return;
    const shape = datasetShape(effective);
    const columns = [
      ...(shape.dimension
        ? [
            {
              key: shape.dimension,
              label: fieldLabel(effective, DIM_KEY) || "Aufteilung",
              source: sourceColumn(effective, DIM_KEY),
            },
          ]
        : []),
      ...(shape.dimension2
        ? [
            {
              key: shape.dimension2,
              label: fieldLabel(effective, DIM2_KEY) || "Aufteilung 2",
              source: sourceColumn(effective, DIM2_KEY),
            },
          ]
        : []),
      ...shape.metrics.map((m, index) => ({
        key: m.key,
        label: m.label,
        source: metricSource(effective, index),
      })),
    ];
    try {
      const labels = uniqueLabels(columns.map((c) => c.label));
      const names = columns.length ? labels : result.columns;
      const sources = columns.length ? columns.map((c) => c.source) : result.columns;
      const rows = columns.length
        ? result.rows.map((row) =>
            Object.fromEntries(columns.map((c, i) => [labels[i], row[c.key]])),
          )
        : result.rows;
      let masked = rows;
      if (connection && useMaskingDisplay.getState().enabled[connection.id]) {
        const config = await queryClient.fetchQuery({
          queryKey: ["mcp-config"],
          queryFn: loadMcpConfig,
          staleTime: 60_000,
        });
        const { rules, replacement } = connectionMaskRules(connection, config);
        const named = sources.filter((source): source is string => Boolean(source));
        const masks = resolveMasks(named, rules, replacement).flatMap((mask) =>
          sources.flatMap((source, index) =>
            source === mask.column ? [{ ...mask, column: names[index] }] : [],
          ),
        );
        masked = applyMasks(names, rows, masks);
      }
      const saved = await exportRowsCsv(title, names, masked);
      if (saved) toast.success("CSV exportiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export fehlgeschlagen");
    }
  };

  const highlightCss = useMemo(() => {
    if (!own.length) return "";
    const scope = `[data-cross-scope="${CSS.escape(scopeId)}"]`;
    return own
      .map((filter) => {
        const attr = filter.key === DIM2_KEY ? "data-dim2" : "data-dim";
        return `${scope} [${attr}]:not([${attr}="${CSS.escape(JSON.stringify(filter.value ?? null))}"]) { opacity: 0.35; }`;
      })
      .join("\n");
  }, [own, scopeId]);

  return {
    interactive: Boolean(dashboardId),
    effective,
    point,
    closePoint: () => setPoint(null),
    onContentClick,
    onContentKeyDown,
    filterPoint,
    detailsPoint,
    openAllDetails: options.drill && effective ? () => openDetails([], "Alle Zeilen") : undefined,
    exportCsv,
    highlightCss,
    scopeId,
    clearOwnFilter:
      own.length && dashboardId
        ? () => useCrossFilterStore.getState().remove(dashboardId, widget.id)
        : undefined,
    pointer: Boolean(dashboardId && dataset && (options.crossFilter || options.drill)),
  };
}

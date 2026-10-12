import { create } from "zustand";
import type { DatabaseKind } from "@/lib/db";
import { CALC_PREFIX, datasetJoins, joinRef, parseRef } from "./joins";
import {
  CROSS_WHERE,
  type CrossCondition,
  type Dashboard,
  type Dataset,
  type TimeBucket,
} from "./model";
import { DIM_KEY, DIM2_KEY } from "./sql";
import { readsTable, tablesRead } from "./sql-tables";

export interface CrossField {
  table: string | null;
  tables?: string[];
  column: string;
  bucket: TimeBucket;
}

export interface CrossFilter {
  widgetId: string;
  key: string;
  field: CrossField;
  value: unknown;
  label: string;
}

const NO_FILTERS: CrossFilter[] = [];

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`.toLowerCase();
}

function sameTable(a: string, b: string): boolean {
  const [left, right] = [a.toLowerCase(), b.toLowerCase()];
  if (left === right) return true;
  const name = (value: string) => value.slice(value.lastIndexOf(".") + 1);
  const qualified = (value: string) => value.includes(".");
  return name(left) === name(right) && (!qualified(left) || !qualified(right));
}

export function crossField(
  dataset: Dataset,
  key: string,
  kind: DatabaseKind | null = null,
): CrossField | null {
  if (dataset.mode === "expert") {
    const column = key === DIM2_KEY ? dataset.mapping.dimension2 : dataset.mapping.dimension;
    const output = key === DIM_KEY || key === DIM2_KEY ? column : key;
    if (!output) return null;
    const tables = tablesRead(dataset.sql, kind).map((ref) =>
      ref.schema ? `${ref.schema}.${ref.name}` : ref.name,
    );
    return { table: null, tables: [...new Set(tables)], column: output, bucket: "none" };
  }
  const s = dataset.simple;
  const ref = key === DIM2_KEY ? s.dimension2 : key === DIM_KEY ? s.dimension?.column : null;
  if (!ref || ref.startsWith(CALC_PREFIX)) return null;
  const { join, column } = parseRef(ref, s);
  return {
    table: join ? tableKey(join.schema, join.table) : tableKey(s.schema, s.table),
    column,
    bucket: key === DIM_KEY ? (s.dimension?.bucket ?? "none") : "none",
  };
}

export function ownCondition(dataset: Dataset, key: string, value: unknown): CrossCondition | null {
  if (dataset.mode === "expert") {
    const field = crossField(dataset, key);
    return field ? { ref: field.column, bucket: "none", value } : null;
  }
  const s = dataset.simple;
  const ref = key === DIM2_KEY ? s.dimension2 : key === DIM_KEY ? s.dimension?.column : null;
  if (!ref || ref.startsWith(CALC_PREFIX)) return null;
  return { ref, bucket: key === DIM_KEY ? (s.dimension?.bucket ?? "none") : "none", value };
}

function targetRef(dataset: Dataset, field: CrossField, kind: DatabaseKind | null): string | null {
  if (dataset.mode === "expert") {
    if (field.bucket !== "none") return null;
    const sources = field.table ? [field.table] : (field.tables ?? []);
    if (!sources.some((table) => readsTable(dataset.sql, table, kind))) return null;
    const { dimension, dimension2 } = dataset.mapping;
    return (
      [dimension, dimension2].find(
        (name) => name && name.toLowerCase() === field.column.toLowerCase(),
      ) ?? null
    );
  }
  if (!field.table) return null;
  const s = dataset.simple;
  if (sameTable(tableKey(s.schema, s.table), field.table)) return field.column;
  const join = datasetJoins(s).find((j) =>
    sameTable(tableKey(j.schema, j.table), field.table ?? ""),
  );
  return join?.id ? joinRef(join.id, field.column) : null;
}

export function crossConditions(
  dataset: Dataset,
  filters: CrossFilter[],
  widgetId: string,
  kind: DatabaseKind | null = null,
) {
  const conditions: CrossCondition[] = [];
  for (const filter of filters) {
    if (filter.widgetId === widgetId) continue;
    const ref = targetRef(dataset, filter.field, kind);
    if (ref) conditions.push({ ref, bucket: filter.field.bucket, value: filter.value });
  }
  return conditions;
}

export function applyCrossFilters(
  dataset: Dataset,
  filters: CrossFilter[],
  widgetId: string,
  kind: DatabaseKind | null = null,
): Dataset {
  if (!filters.length) return dataset;
  const conditions = crossConditions(dataset, filters, widgetId, kind);
  if (!conditions.length) return dataset;
  return dataset.mode === "simple"
    ? { ...dataset, simple: { ...dataset.simple, [CROSS_WHERE]: conditions } }
    : { ...dataset, [CROSS_WHERE]: conditions };
}

export function crossFilterReaches(
  dataset: Dataset,
  filter: CrossFilter,
  kind: DatabaseKind | null = null,
): boolean {
  return targetRef(dataset, filter.field, kind) !== null;
}

interface CrossFilterState {
  filters: Record<string, CrossFilter[]>;
  toggle: (dashboardId: string, filter: CrossFilter) => void;
  select: (dashboardId: string, filters: CrossFilter[]) => void;
  retain: (dashboardId: string, keep: (filter: CrossFilter) => boolean) => void;
  remove: (dashboardId: string, widgetId: string, key?: string) => void;
  clear: (dashboardId: string) => void;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useCrossFilterStore = create<CrossFilterState>()((set) => ({
  filters: {},
  toggle: (dashboardId, filter) =>
    set((state) => {
      const current = state.filters[dashboardId] ?? NO_FILTERS;
      const existing = current.find((f) => f.widgetId === filter.widgetId && f.key === filter.key);
      const rest = current.filter((f) => !(f.widgetId === filter.widgetId && f.key === filter.key));
      const next = existing && sameValue(existing.value, filter.value) ? rest : [...rest, filter];
      return { filters: { ...state.filters, [dashboardId]: next } };
    }),
  select: (dashboardId, filters) =>
    set((state) => {
      const current = state.filters[dashboardId] ?? NO_FILTERS;
      const replaced = (f: CrossFilter) =>
        filters.some((next) => next.widgetId === f.widgetId && next.key === f.key);
      const all = filters.every((next) =>
        current.some(
          (f) =>
            f.widgetId === next.widgetId && f.key === next.key && sameValue(f.value, next.value),
        ),
      );
      const rest = current.filter((f) => !replaced(f));
      return { filters: { ...state.filters, [dashboardId]: all ? rest : [...rest, ...filters] } };
    }),
  retain: (dashboardId, keep) =>
    set((state) => {
      const current = state.filters[dashboardId] ?? NO_FILTERS;
      const next = current.filter(keep);
      return next.length === current.length
        ? state
        : { filters: { ...state.filters, [dashboardId]: next } };
    }),
  remove: (dashboardId, widgetId, key) =>
    set((state) => ({
      filters: {
        ...state.filters,
        [dashboardId]: (state.filters[dashboardId] ?? NO_FILTERS).filter(
          (f) => f.widgetId !== widgetId || (key !== undefined && f.key !== key),
        ),
      },
    })),
  clear: (dashboardId) =>
    set((state) => ({ filters: { ...state.filters, [dashboardId]: NO_FILTERS } })),
}));

export function useCrossFilters(dashboardId: string | null): CrossFilter[] {
  return useCrossFilterStore((state) =>
    dashboardId ? (state.filters[dashboardId] ?? NO_FILTERS) : NO_FILTERS,
  );
}

export function staleFilter(
  filter: CrossFilter,
  dashboard: Pick<Dashboard, "widgets" | "datasets">,
  kind: DatabaseKind | null,
): boolean {
  const widget = dashboard.widgets.find((w) => w.id === filter.widgetId);
  if (!widget || widget.block || widget.options?.crossFilter === false) return true;
  const dataset = dashboard.datasets.find((d) => d.id === widget.datasetId);
  const field = dataset ? crossField(dataset, filter.key, kind) : null;
  return JSON.stringify(field) !== JSON.stringify(filter.field);
}

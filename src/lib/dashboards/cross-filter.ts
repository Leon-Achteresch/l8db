import { create } from "zustand";
import { CALC_PREFIX, datasetJoins, joinRef, parseRef } from "./joins";
import { CROSS_WHERE, type CrossCondition, type Dataset, type TimeBucket } from "./model";
import { DIM_KEY, DIM2_KEY } from "./sql";

export interface CrossField {
  table: string | null;
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

export function crossField(dataset: Dataset, key: string): CrossField | null {
  if (dataset.mode === "expert") {
    const column = key === DIM2_KEY ? dataset.mapping.dimension2 : dataset.mapping.dimension;
    const output = key === DIM_KEY || key === DIM2_KEY ? column : key;
    return output ? { table: null, column: output, bucket: "none" } : null;
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

function mentionsTable(sql: string, table: string): boolean {
  const name = table.slice(table.lastIndexOf(".") + 1);
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = `["\`\\[]?${escaped}["\`\\]]?`;
  const qualifier = `(?:["\`\\[]?[\\w$]+["\`\\]]?\\.)*`;
  return new RegExp(`\\b(?:from|join)\\s+${qualifier}${quoted}(?![\\w$])`, "i").test(sql);
}

function targetRef(dataset: Dataset, field: CrossField): string | null {
  if (dataset.mode === "expert") {
    if (field.bucket !== "none") return null;
    if (field.table && !mentionsTable(dataset.sql, field.table)) return null;
    const { dimension, dimension2 } = dataset.mapping;
    return (
      [dimension, dimension2].find(
        (name) => name && name.toLowerCase() === field.column.toLowerCase(),
      ) ?? null
    );
  }
  if (!field.table) return null;
  const s = dataset.simple;
  if (tableKey(s.schema, s.table) === field.table) return field.column;
  const join = datasetJoins(s).find((j) => tableKey(j.schema, j.table) === field.table);
  return join?.id ? joinRef(join.id, field.column) : null;
}

export function crossConditions(dataset: Dataset, filters: CrossFilter[], widgetId: string) {
  const conditions: CrossCondition[] = [];
  for (const filter of filters) {
    if (filter.widgetId === widgetId) continue;
    const ref = targetRef(dataset, filter.field);
    if (ref) conditions.push({ ref, bucket: filter.field.bucket, value: filter.value });
  }
  return conditions;
}

export function applyCrossFilters(
  dataset: Dataset,
  filters: CrossFilter[],
  widgetId: string,
): Dataset {
  if (!filters.length) return dataset;
  const conditions = crossConditions(dataset, filters, widgetId);
  if (!conditions.length) return dataset;
  return dataset.mode === "simple"
    ? { ...dataset, simple: { ...dataset.simple, [CROSS_WHERE]: conditions } }
    : { ...dataset, [CROSS_WHERE]: conditions };
}

export function crossFilterReaches(dataset: Dataset, filter: CrossFilter): boolean {
  return targetRef(dataset, filter.field) !== null;
}

interface CrossFilterState {
  filters: Record<string, CrossFilter[]>;
  toggle: (dashboardId: string, filter: CrossFilter) => void;
  select: (dashboardId: string, filters: CrossFilter[]) => void;
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

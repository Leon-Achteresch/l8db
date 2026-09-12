import { gridCellText } from "@/lib/grid-search";
import {
  type FilterOperatorKey,
  filterOperatorLabel,
  operatorNeedsList,
  operatorNeedsValue,
  parseFilterList,
} from "@/lib/sql-filter";

export type ResultRow = Record<string, unknown>;

export type ResultSortDirection = "asc" | "desc";

export interface ResultSort {
  column: string;
  direction: ResultSortDirection;
}

export type ResultFilterOperator = FilterOperatorKey | "equals" | "is_null" | "not_null";

export function normalizeResultFilterOperator(operator: ResultFilterOperator): FilterOperatorKey {
  if (operator === "equals") return "eq";
  if (operator === "is_null") return "isNull";
  if (operator === "not_null") return "isNotNull";
  return operator;
}

export interface ResultFilter {
  operator: ResultFilterOperator;
  value: string;
}

export type ResultFilters = Record<string, ResultFilter>;

export type ResultValueKind = "number" | "date" | "text";

const textCollator = new Intl.Collator("de", { sensitivity: "base" });

const NUMBER_PATTERN = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([ T][\d:.]+([+-][\d:]+|Z)?)?$/;

export function resultCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return gridCellText(value);
}

export function isNullValue(value: unknown): boolean {
  return value === null || value === undefined;
}

export function detectColumnKind(
  rows: ResultRow[],
  column: string,
  sampleSize = 200,
): ResultValueKind {
  let seen = 0;
  let numeric = true;
  let dateLike = true;
  for (const row of rows) {
    const value = row[column];
    if (isNullValue(value)) continue;
    const text = resultCellText(value).trim();
    if (text === "") continue;
    seen += 1;
    if (numeric && !NUMBER_PATTERN.test(text)) numeric = false;
    if (dateLike && (!DATE_PATTERN.test(text) || Number.isNaN(Date.parse(text)))) dateLike = false;
    if (!numeric && !dateLike) return "text";
    if (seen >= sampleSize) break;
  }
  if (seen === 0) return "text";
  if (numeric) return "number";
  if (dateLike) return "date";
  return "text";
}

export function detectColumnKinds(
  rows: ResultRow[],
  columns: string[],
): Record<string, ResultValueKind> {
  const kinds: Record<string, ResultValueKind> = {};
  for (const column of columns) {
    kinds[column] = detectColumnKind(rows, column);
  }
  return kinds;
}

export function compareResultValues(a: unknown, b: unknown, kind: ResultValueKind): number {
  const aNull = isNullValue(a);
  const bNull = isNullValue(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const left = resultCellText(a);
  const right = resultCellText(b);
  if (kind === "number") {
    const leftNum = Number(left);
    const rightNum = Number(right);
    const leftValid = Number.isFinite(leftNum);
    const rightValid = Number.isFinite(rightNum);
    if (leftValid && rightValid) {
      if (leftNum < rightNum) return -1;
      if (leftNum > rightNum) return 1;
      return 0;
    }
    if (leftValid) return -1;
    if (rightValid) return 1;
  }
  if (kind === "date") {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    const leftValid = !Number.isNaN(leftTime);
    const rightValid = !Number.isNaN(rightTime);
    if (leftValid && rightValid) {
      if (leftTime < rightTime) return -1;
      if (leftTime > rightTime) return 1;
      return 0;
    }
    if (leftValid) return -1;
    if (rightValid) return 1;
  }
  return textCollator.compare(left, right);
}

export function toggleResultSort(
  sorts: ResultSort[],
  column: string,
  additive = false,
): ResultSort[] {
  const existing = sorts.find((sort) => sort.column === column);
  if (!additive) {
    if (!existing || sorts.length !== 1) return [{ column, direction: "asc" }];
    if (existing.direction === "asc") return [{ column, direction: "desc" }];
    return [];
  }
  if (!existing) return [...sorts, { column, direction: "asc" }];
  if (existing.direction === "asc") {
    return sorts.map((sort) =>
      sort.column === column ? { column, direction: "desc" as const } : sort,
    );
  }
  return sorts.filter((sort) => sort.column !== column);
}

export function sortDirectionFor(sorts: ResultSort[], column: string): ResultSortDirection | null {
  return sorts.find((sort) => sort.column === column)?.direction ?? null;
}

export function sortRankFor(sorts: ResultSort[], column: string): number | null {
  const index = sorts.findIndex((sort) => sort.column === column);
  return index < 0 ? null : index + 1;
}

export function compareForSort(
  a: unknown,
  b: unknown,
  kind: ResultValueKind,
  direction: ResultSortDirection,
): number {
  const aNull = isNullValue(a);
  const bNull = isNullValue(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const result = compareResultValues(a, b, kind);
  return direction === "asc" ? result : -result;
}

export function sortResultRows(
  rows: ResultRow[],
  sorts: ResultSort[],
  kinds: Record<string, ResultValueKind> = {},
): ResultRow[] {
  if (sorts.length === 0) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const sort of sorts) {
        const kind = kinds[sort.column] ?? "text";
        const result = compareForSort(
          left.row[sort.column],
          right.row[sort.column],
          kind,
          sort.direction,
        );
        if (result !== 0) return result;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function isFilterActive(filter: ResultFilter | undefined): boolean {
  if (!filter) return false;
  const operator = normalizeResultFilterOperator(filter.operator);
  if (!operatorNeedsValue(operator)) return true;
  if (operatorNeedsList(operator)) return parseFilterList(filter.value).length > 0;
  return filter.value.trim() !== "";
}

export function activeFilterCount(filters: ResultFilters): number {
  return Object.values(filters).filter((filter) => isFilterActive(filter)).length;
}

export function matchesResultFilter(value: unknown, filter: ResultFilter): boolean {
  const operator = normalizeResultFilterOperator(filter.operator);
  if (operator === "isNull") return isNullValue(value);
  if (operator === "isNotNull") return !isNullValue(value);
  if (!isFilterActive(filter)) return true;
  if (isNullValue(value)) return false;
  const needle = filter.value.trim().toLowerCase();
  const haystack = resultCellText(value).toLowerCase();
  if (operatorNeedsList(operator)) {
    const includes = parseFilterList(filter.value).some(
      (entry) => haystack.trim() === entry.trim().toLowerCase(),
    );
    return operator === "in" ? includes : !includes;
  }
  switch (operator) {
    case "eq":
      return haystack.trim() === needle;
    case "neq":
      return haystack.trim() !== needle;
    case "contains":
      return haystack.includes(needle);
    case "startsWith":
      return haystack.startsWith(needle);
    case "endsWith":
      return haystack.endsWith(needle);
    default: {
      const kind = detectColumnKind([{ value }, { value: filter.value }], "value");
      const comparison = compareResultValues(value, filter.value, kind);
      if (operator === "gt") return comparison > 0;
      if (operator === "gte") return comparison >= 0;
      if (operator === "lt") return comparison < 0;
      if (operator === "lte") return comparison <= 0;
      return false;
    }
  }
}

export function filterResultRows(rows: ResultRow[], filters: ResultFilters): ResultRow[] {
  const entries = Object.entries(filters).filter(([, filter]) => isFilterActive(filter));
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([column, filter]) => matchesResultFilter(row[column], filter)),
  );
}

export function applyResultView(
  rows: ResultRow[],
  columns: string[],
  sorts: ResultSort[],
  filters: ResultFilters,
): ResultRow[] {
  const filtered = filterResultRows(rows, filters);
  if (sorts.length === 0) return filtered;
  return sortResultRows(
    filtered,
    sorts,
    detectColumnKinds(
      rows,
      sorts.map((sort) => sort.column).filter((column) => columns.includes(column)),
    ),
  );
}

export function describeResultCount(visible: number, total: number): string {
  const unit = total === 1 ? "Zeile" : "Zeilen";
  if (visible === total) return `${total} ${unit}`;
  return `${visible} von ${total} ${unit}`;
}

export function resultFilterOperatorLabel(
  operator: ResultFilterOperator,
  translated = true,
): string {
  return filterOperatorLabel(normalizeResultFilterOperator(operator), translated);
}

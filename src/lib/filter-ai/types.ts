import type { FilterKind } from "@/lib/sql-filter";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";

export type FilterAiMode = "simple" | "sql";

export interface FilterAiContext {
  kind: FilterKind;
  json: boolean;
  mode: FilterAiMode;
  columns: string[];
  columnDetails?: { name: string; data_type: string }[];
  conditions: FilterCondition[];
  combinator: "AND" | "OR";
  sql: string;
  rules: RowRule[];
  today: string;
}

export interface FilterAiProposal {
  conditions: FilterCondition[] | null;
  combinator: "AND" | "OR";
  sql: string | null;
  rules: RowRule[] | null;
  note: string;
  warnings: string[];
}

export interface FilterAiChange {
  kind: "add" | "remove" | "keep";
  target: "filter" | "rule" | "sql";
  label: string;
  color?: string;
}

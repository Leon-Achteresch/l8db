export const DATA_COMPARE_MAX_ROWS = 10000;

export type DataDiffCategory = "only_left" | "only_right" | "changed" | "equal";

export interface DataCompareColumn {
  name: string;
  data_type: string;
}

export interface DataComparePlanInput {
  leftColumns: DataCompareColumn[];
  rightColumns: DataCompareColumn[];
  leftKeyColumns: string[];
  rightKeyColumns: string[];
}

export interface DataComparePlan {
  keyColumns: string[];
  compareColumns: string[];
  error: string | null;
}

export interface CellDifference {
  column: string;
  left: unknown;
  right: unknown;
}

export interface DataDiffRow {
  keyText: string;
  keyValues: Record<string, unknown>;
  category: DataDiffCategory;
  left: Record<string, unknown> | null;
  right: Record<string, unknown> | null;
  differences: CellDifference[];
}

export interface DataCompareCounts {
  only_left: number;
  only_right: number;
  changed: number;
  equal: number;
}

export interface DataCompareInput {
  keyColumns: string[];
  compareColumns: string[];
  left: Record<string, unknown>[];
  right: Record<string, unknown>[];
}

export interface DataCompareResult {
  rows: DataDiffRow[];
  counts: DataCompareCounts;
}

export class DataCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataCompareError";
  }
}

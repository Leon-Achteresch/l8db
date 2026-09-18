import type { DataCompareSideSelection } from "@/features/compare/data-compare-side-picker";
import type { DataCompareResult, DataDiffCategory } from "@/lib/data-compare";

export type CategoryFilter = DataDiffCategory | "all";

export interface LoadedSide {
  columns: { name: string; data_type: string }[];
  keyColumns: string[];
  rows: Record<string, unknown>[];
  capturedAt: string;
}

export interface CompareState {
  result: DataCompareResult;
  keyColumns: string[];
  compareColumns: string[];
  leftCapturedAt: string;
  rightCapturedAt: string;
  left: DataCompareSideSelection;
  right: DataCompareSideSelection;
}

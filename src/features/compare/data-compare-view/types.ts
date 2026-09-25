import type { DataCompareSideSelection } from "@/features/compare/data-compare-side-picker";
import type { DataCompareResult, DataDiffCategory } from "@/lib/data-compare";

export type CategoryFilter = DataDiffCategory | "all";

export interface LoadedSide {
  columns: { name: string; data_type: string }[];
  keyColumns: string[];
}

export interface CompareState {
  result: DataCompareResult & { detailsTruncated?: boolean };
  keyColumns: string[];
  compareColumns: string[];
  columnTypes: { left: Record<string, string>; right: Record<string, string> };
  left: DataCompareSideSelection;
  right: DataCompareSideSelection;
}

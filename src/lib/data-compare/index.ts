export {
  canonicalValue,
  compareTableData,
  planDataCompare,
  rowKeyText,
  valuesEqual,
} from "./compare";
export type { SyncDirection, SyncScriptInput, SyncScriptResult } from "./sync-script";
export { buildSyncScript } from "./sync-script";
export type {
  CellDifference,
  DataCompareColumn,
  DataCompareCounts,
  DataCompareInput,
  DataComparePlan,
  DataComparePlanInput,
  DataCompareResult,
  DataDiffCategory,
  DataDiffRow,
} from "./types";
export { DATA_COMPARE_MAX_ROWS, DataCompareError } from "./types";

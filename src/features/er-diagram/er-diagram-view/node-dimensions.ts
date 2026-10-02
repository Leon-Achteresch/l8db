import { HEADER_HEIGHT, ROW_HEIGHT } from "@/features/er-diagram/er-diagram-view/constants";
import type { ERTable } from "@/lib/db";

export function estimateNodeHeight(table: ERTable): number {
  return (
    HEADER_HEIGHT + 2 + table.columns.length * ROW_HEIGHT + Math.max(0, table.columns.length - 1)
  );
}

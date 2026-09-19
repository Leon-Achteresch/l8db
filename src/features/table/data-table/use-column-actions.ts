import { useCallback, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { fitHeaderColumnWidth, measureHeaderTitleWidth } from "@/lib/column-header-width";
import type { ForeignKeyInfo } from "@/lib/db";
import { formatVisibleColumnNames, toggleHiddenColumn } from "@/lib/table-column-prefs";
import type { getColumnTypeInfo } from "./column-type-info";

type Options = {
  order: string[];
  hidden: string[];
  setHidden: (hidden: string[]) => void;
  savedColumnSizing: Record<string, number>;
  setColumnSizing: (sizing: Record<string, number>) => void;
  fkByColumn: Map<string, ForeignKeyInfo[]>;
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>;
};

export function useColumnActions({
  order,
  hidden,
  setHidden,
  savedColumnSizing,
  setColumnSizing,
  fkByColumn,
  typeInfoByColumn,
}: Options) {
  const [togglingColumn, setTogglingColumn] = useState<string | null>(null);

  const copyColumnNames = useCallback(() => {
    const names = formatVisibleColumnNames(order, hidden);
    if (names === "") return;
    void copyText(names);
    toast.success("Spaltennamen kopiert.");
  }, [order, hidden]);

  const fitHeaderWidths = useCallback(() => {
    const hiddenSet = new Set(hidden);
    const next = { ...savedColumnSizing };
    for (const column of order) {
      if (hiddenSet.has(column)) continue;
      next[column] = fitHeaderColumnWidth(
        measureHeaderTitleWidth(column, typeInfoByColumn.get(column)?.label),
        fkByColumn.has(column),
      );
    }
    setColumnSizing(next);
  }, [fkByColumn, typeInfoByColumn, hidden, order, savedColumnSizing, setColumnSizing]);

  const handleColumnToggle = useCallback(
    (column: string) => {
      if (togglingColumn) return;
      setTogglingColumn(column);
      setHidden(toggleHiddenColumn(order, hidden, column));
      requestAnimationFrame(() => setTogglingColumn(null));
    },
    [hidden, order, setHidden, togglingColumn],
  );

  return { togglingColumn, copyColumnNames, fitHeaderWidths, handleColumnToggle };
}

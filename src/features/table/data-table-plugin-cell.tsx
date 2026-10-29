import { memo, useContext, useMemo } from "react";
import { UiPluginGridContext } from "@/lib/ui-plugins/grid";
import { DataTableCell, type DataTableCellProps } from "./data-table-cell";

export const DataTablePluginCell = memo(function DataTablePluginCell(props: DataTableCellProps) {
  const { row, column, cellIndex } = props;
  const pluginGrid = useContext(UiPluginGridContext);
  const plugin = useMemo(
    () =>
      pluginGrid && cellIndex > 0
        ? {
            output: pluginGrid.cell?.(row.getValue(column.id), row.original, column.id, row.index),
            align: pluginGrid.align?.[column.id],
            resetKey: pluginGrid,
          }
        : undefined,
    [pluginGrid, row, column, cellIndex],
  );
  return <DataTableCell {...props} plugin={plugin} />;
});

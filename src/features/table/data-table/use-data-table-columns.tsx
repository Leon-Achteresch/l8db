import type { ColumnDef, HeaderContext } from "@tanstack/react-table";
import { useMemo, useRef } from "react";
import { DataTableColumnHeader } from "@/features/table/data-table-column-header";
import { CONTENT_COLUMN_MIN } from "@/lib/column-content-width";
import { COLUMN_SIZE_MAX, COLUMN_SIZE_MIN } from "@/lib/column-header-width";
import type { DetailedColumnInfo, ForeignKeyInfo } from "@/lib/db";
import { useSettingsStore } from "@/lib/settings";
import { tableCellPreview } from "@/lib/table-cell-preview";
import type { DataTableProps, TableRow } from "../data-table-types";
import { getColumnTypeInfo } from "./column-type-info";
import { INDEX_COLUMN } from "./constants";
import { fkLinksFor } from "./fk-links";
import { FkPreviewPopover } from "./fk-preview-popover";

type Options = {
  columnNames: string[];
  data: TableRow[];
  columnDetails?: DetailedColumnInfo[];
  isFetching: boolean;
  page: number;
  pageSize: number;
  fkByColumn: Map<string, ForeignKeyInfo[]>;
  onNavigateToTable: DataTableProps["onNavigateToTable"];
  currentSchema?: string;
  currentTable?: string;
  sortableColumns?: string[];
};

export function useDataTableColumns({
  columnNames,
  data,
  columnDetails,
  isFetching,
  page,
  pageSize,
  fkByColumn,
  onNavigateToTable,
  currentSchema,
  currentTable,
  sortableColumns,
}: Options) {
  const typeInfoByColumn = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getColumnTypeInfo>>();
    const detailByName = new Map((columnDetails ?? []).map((c) => [c.name, c]));
    for (const column of columnNames) {
      map.set(column, getColumnTypeInfo(column, data, detailByName.get(column)));
    }
    return map;
  }, [columnNames, data, columnDetails]);
  const dataTypeByColumn = useMemo(
    () => new Map((columnDetails ?? []).map((c) => [c.name, c.data_type])),
    [columnDetails],
  );
  const contentFit = useSettingsStore((state) => state.tableStyle !== "classic");
  const headerStateRef = useRef({ typeInfoByColumn, isFetching, page, pageSize });
  headerStateRef.current = { typeInfoByColumn, isFetching, page, pageSize };

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        id: INDEX_COLUMN,
        header: () => (
          <span
            title="Rechtsklick: Spalten"
            className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase select-none"
          >
            #
          </span>
        ),
        enableSorting: false,
        enableResizing: false,
        cell: (info) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground/60 select-none">
            {info.row.index + 1 + headerStateRef.current.page * headerStateRef.current.pageSize}
          </span>
        ),
        size: 48,
      },
      ...columnNames.map(
        (column): ColumnDef<TableRow> => ({
          id: column,
          accessorFn: (row) => row[column],
          meta: { dataType: dataTypeByColumn.get(column) },
          enableSorting: !sortableColumns || sortableColumns.includes(column),
          size: 200,
          minSize: contentFit ? CONTENT_COLUMN_MIN : COLUMN_SIZE_MIN,
          maxSize: COLUMN_SIZE_MAX,
          header: ({ column: col }: HeaderContext<TableRow, unknown>) => {
            const typeInfo =
              headerStateRef.current.typeInfoByColumn.get(column) ?? getColumnTypeInfo(column, []);
            const columnFks = fkByColumn.get(column);
            const fkTitle =
              columnFks?.length && currentSchema && currentTable
                ? fkLinksFor(columnFks, currentSchema, currentTable, column)
                    .map((link) =>
                      link.isOutgoing
                        ? `FK -> ${link.schema}.${link.table}.${link.column}`
                        : `<- ${link.schema}.${link.table}.${link.column}`,
                    )
                    .join("\n")
                : undefined;
            return (
              <DataTableColumnHeader
                name={column}
                column={col}
                typeInfo={typeInfo}
                isFk={!!columnFks?.length}
                fkTitle={fkTitle}
                isFetching={headerStateRef.current.isFetching}
              />
            );
          },
          cell: (info) => {
            const value = info.getValue();
            const fks = fkByColumn.get(column);
            if (fks?.length && onNavigateToTable && currentSchema && currentTable) {
              return (
                <FkPreviewPopover
                  fks={fks}
                  column={column}
                  value={value}
                  currentSchema={currentSchema}
                  currentTable={currentTable}
                  onNavigate={onNavigateToTable}
                >
                  <div className="truncate">{tableCellPreview(value).text}</div>
                </FkPreviewPopover>
              );
            }
            return tableCellPreview(value).text;
          },
        }),
      ),
    ],
    [
      columnNames,
      fkByColumn,
      onNavigateToTable,
      currentSchema,
      currentTable,
      sortableColumns,
      dataTypeByColumn,
      contentFit,
    ],
  );
  return { columns, typeInfoByColumn };
}

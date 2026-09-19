import type { ColumnDef, HeaderContext } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide";
import { LinkIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useMemo, useRef } from "react";
import { DataTableHeaderName } from "@/features/table/data-table-header-name";
import { COLUMN_SIZE_MAX, COLUMN_SIZE_MIN } from "@/lib/column-header-width";
import type { DetailedColumnInfo, ForeignKeyInfo } from "@/lib/db";
import { tableCellPreview } from "@/lib/table-cell-preview";
import { cn } from "@/lib/utils";
import type { DataTableProps, TableRow } from "../data-table-types";
import { getColumnTypeInfo } from "./column-type-info";
import { INDEX_COLUMN } from "./constants";
import { fkLinksFor } from "./fk-links";
import { FkPreviewPopover } from "./fk-preview-popover";
import { renderTypeIcon } from "./render-type-icon";

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
          enableSorting: !sortableColumns || sortableColumns.includes(column),
          size: 200,
          minSize: COLUMN_SIZE_MIN,
          maxSize: COLUMN_SIZE_MAX,
          header: ({ column: col }: HeaderContext<TableRow, unknown>) => {
            const typeInfo =
              headerStateRef.current.typeInfoByColumn.get(column) ?? getColumnTypeInfo(column, []);
            const sorted = col.getIsSorted();
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
              <div className="flex items-center gap-2 w-full min-w-0 justify-start" title={fkTitle}>
                <button
                  type="button"
                  onClick={col.getToggleSortingHandler()}
                  disabled={headerStateRef.current.isFetching || !col.getCanSort()}
                  className="group flex items-center gap-1 rounded-sm px-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer min-w-0 shrink"
                >
                  {!!columnFks?.length && <LinkIcon className="size-3 shrink-0 text-blue-500" />}
                  <DataTableHeaderName name={column} isFk={!!columnFks?.length} />
                  <span
                    className={cn(
                      "shrink-0 text-muted-foreground transition-colors",
                      !col.getCanSort()
                        ? "hidden"
                        : sorted
                          ? "text-primary"
                          : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <MorphIcon
                      icon={
                        sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown
                      }
                      className={cn("size-3", !sorted && "text-muted-foreground/45")}
                    />
                  </span>
                </button>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded border px-1 py-[1px] text-[9px] font-mono leading-none tracking-wider uppercase font-semibold select-none whitespace-nowrap",
                      typeInfo.colorClass,
                    )}
                  >
                    {renderTypeIcon(typeInfo.iconName, "size-2.5")}
                    <span>{typeInfo.label}</span>
                  </div>
                </div>
              </div>
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
                  <div className="truncate text-left">{tableCellPreview(value).text}</div>
                </FkPreviewPopover>
              );
            }
            return tableCellPreview(value).text;
          },
        }),
      ),
    ],
    [columnNames, fkByColumn, onNavigateToTable, currentSchema, currentTable, sortableColumns],
  );
  return { columns, typeInfoByColumn };
}

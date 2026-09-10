import { useMemo } from "react";

import {
  type ColumnDef,
  type HeaderContext,
  type OnChangeFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type TableRow = Record<string, unknown>;

const INDEX_COLUMN = "__row_index__";

function renderValue(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/80 italic">NULL</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="font-mono text-xs text-sky-600 dark:text-sky-400">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="font-mono tabular-nums">{String(value)}</span>;
  }
  if (typeof value === "object") {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {JSON.stringify(value)}
      </span>
    );
  }
  return <span className="font-mono text-[13px]">{String(value)}</span>;
}

function cellAlign(value: unknown) {
  if (typeof value === "number") return "text-right";
  return "text-left";
}

type DataTableProps = {
  columns: string[];
  data: TableRow[];
  emptyMessage: string;
  className?: string;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  isFetching?: boolean;
};

export function DataTable({
  columns: columnNames,
  data,
  emptyMessage,
  className,
  sorting,
  onSortingChange,
  isFetching = false,
}: DataTableProps) {
  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        id: INDEX_COLUMN,
        header: () => (
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            #
          </span>
        ),
        enableSorting: false,
        cell: (info) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {info.row.index + 1}
          </span>
        ),
        size: 48,
      },
      ...columnNames.map(
        (column): ColumnDef<TableRow> => ({
          accessorKey: column,
          header: ({ column: col }: HeaderContext<TableRow, unknown>) => {
            const sorted = col.getIsSorted();
            return (
              <button
                type="button"
                onClick={col.getToggleSortingHandler()}
                disabled={isFetching}
                className={cn(
                  "group flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors",
                  "hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                  sorted && "text-foreground",
                )}
              >
                <span className="truncate font-medium">{column}</span>
                <span
                  className={cn(
                    "shrink-0 text-muted-foreground transition-colors",
                    sorted
                      ? "text-foreground"
                      : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  {sorted === "asc" ? (
                    <ArrowUpIcon className="size-3.5" />
                  ) : sorted === "desc" ? (
                    <ArrowDownIcon className="size-3.5" />
                  ) : (
                    <ArrowUpDownIcon className="size-3.5" />
                  )}
                </span>
              </button>
            );
          },
          cell: (info) => {
            const value = info.getValue();
            return (
              <div className={cn("max-w-[28rem] truncate", cellAlign(value))}>
                {renderValue(value)}
              </div>
            );
          },
        }),
      ),
    ],
    [columnNames, isFetching],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const colSpan = table.getAllColumns().length || 1;
  const activeSort = sorting[0];

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-auto transition-opacity",
          isFetching && "opacity-60",
        )}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => (
                  <th
                    key={header.id}
                    className={cn(
                      "border-b border-border bg-muted/60 px-3 py-2.5 text-left align-middle backdrop-blur-sm",
                      index === 0 && "w-12 border-r border-border/60 pr-2 pl-3",
                      index > 0 && "min-w-[8rem]",
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-3 py-16 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border/50 transition-colors hover:bg-muted/40",
                    rowIndex % 2 === 1 && "bg-muted/20",
                  )}
                >
                  {row.getVisibleCells().map((cell, cellIndex) => {
                    const value =
                      cellIndex > 0
                        ? row.getValue(cell.column.id)
                        : undefined;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 py-2 align-middle",
                          cellIndex === 0 &&
                            "w-12 border-r border-border/40 bg-muted/10 pr-2 pl-3",
                          cellIndex > 0 && cellAlign(value),
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {rows.length} {rows.length === 1 ? "Zeile" : "Zeilen"}
          </span>
          {isFetching ? (
            <span>Sortiere…</span>
          ) : activeSort ? (
            <span className="truncate">
              Sortiert nach{" "}
              <span className="font-medium text-foreground">
                {activeSort.id}
              </span>{" "}
              ({activeSort.desc ? "absteigend" : "aufsteigend"})
            </span>
          ) : (
            <span>Klick auf Spaltenüberschrift zum Sortieren</span>
          )}
        </div>
      )}
    </div>
  );
}

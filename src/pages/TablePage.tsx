import { useEffect, useMemo } from "react";

import { getRouteApi } from "@tanstack/react-router";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveConnection } from "@/lib/connections";
import { useTableRowsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/tables/$schema/$table");

type Row = Record<string, unknown>;

function renderValue(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function TablePage() {
  const { schema, table } = routeApi.useParams();
  const connection = useActiveConnection();
  const openTab = useTableTabs((state) => state.openTab);
  const { data, isLoading, isError, error } = useTableRowsQuery(schema, table);

  useEffect(() => {
    openTab({ schema, table });
  }, [schema, table, openTab]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      (data?.columns ?? []).map((column) => ({
        accessorKey: column,
        header: column,
        cell: (info) => renderValue(info.getValue()),
      })),
    [data?.columns],
  );

  const tableInstance = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!connection) {
    return (
      <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade Daten…
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-destructive">{String(error)}</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto [&>[data-slot=table-container]]:w-max [&>[data-slot=table-container]]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background">
      <Table>
        <TableHeader>
          {tableInstance.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {tableInstance.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length || 1}
                className="h-24 text-center text-muted-foreground"
              >
                Keine Daten.
              </TableCell>
            </TableRow>
          ) : (
            tableInstance.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

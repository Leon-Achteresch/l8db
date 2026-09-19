import { useCallback, useMemo, useState } from "react";
import type { DetailedColumnInfo } from "@/lib/db";
import { compileSingleCondition } from "@/lib/sql-filter";
import type { DataTableProps } from "../data-table-types";

export function useColumnFilter(
  onApplyFilter: DataTableProps["onApplyFilter"],
  compileColumnFilter: DataTableProps["compileColumnFilter"],
  connection: { kind: Parameters<typeof compileSingleCondition>[3] } | null | undefined,
  columnDetails: DetailedColumnInfo[] | undefined,
) {
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [filterOperator, setFilterOperator] = useState("eq");
  const [filterValue, setFilterValue] = useState("");

  const applyColumnFilter = useCallback(() => {
    if (!filterColumn || !onApplyFilter) return;
    const sql = (compileColumnFilter ?? compileSingleCondition)(
      filterColumn,
      filterOperator,
      filterValue,
      connection?.kind,
      columnDetails?.find((column) => column.name === filterColumn)?.data_type,
    );
    if (sql) {
      onApplyFilter(sql, false);
    }
    setFilterColumn(null);
  }, [
    filterColumn,
    filterOperator,
    filterValue,
    onApplyFilter,
    connection?.kind,
    compileColumnFilter,
    columnDetails,
  ]);

  const compiledFilter = useMemo(
    () =>
      filterColumn
        ? ((compileColumnFilter ?? compileSingleCondition)(
            filterColumn,
            filterOperator,
            filterValue,
            connection?.kind,
            columnDetails?.find((column) => column.name === filterColumn)?.data_type,
          ) ?? "")
        : "",
    [
      filterColumn,
      filterOperator,
      filterValue,
      connection?.kind,
      compileColumnFilter,
      columnDetails,
    ],
  );

  return {
    filterColumn,
    setFilterColumn,
    filterOperator,
    setFilterOperator,
    filterValue,
    setFilterValue,
    applyColumnFilter,
    compiledFilter,
  };
}

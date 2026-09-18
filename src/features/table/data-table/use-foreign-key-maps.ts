import { useMemo } from "react";
import type { ForeignKeyInfo } from "@/lib/db";
import type { DataTableProps } from "../data-table-types";

export function useForeignKeyMaps(
  foreignKeys: ForeignKeyInfo[] | undefined,
  currentSchema: string | undefined,
  currentTable: string | undefined,
  onNavigateToTable: DataTableProps["onNavigateToTable"],
) {
  const fkByColumn = useMemo(() => {
    const map = new Map<string, ForeignKeyInfo[]>();
    if (!foreignKeys || !currentSchema || !currentTable) return map;
    const push = (column: string, fk: ForeignKeyInfo) => {
      const list = map.get(column);
      if (list) list.push(fk);
      else map.set(column, [fk]);
    };
    for (const fk of foreignKeys) {
      if (fk.from_schema === currentSchema && fk.from_table === currentTable) {
        push(fk.from_column, fk);
      }
      if (fk.to_schema === currentSchema && fk.to_table === currentTable) {
        push(fk.to_column, fk);
      }
    }
    return map;
  }, [foreignKeys, currentSchema, currentTable]);

  const outgoingFkByColumn = useMemo(() => {
    const map = new Map<string, ForeignKeyInfo>();
    if (!foreignKeys || !currentSchema || !currentTable) return map;
    for (const fk of foreignKeys) {
      if (fk.from_schema === currentSchema && fk.from_table === currentTable) {
        map.set(fk.from_column, fk);
      }
    }
    return map;
  }, [foreignKeys, currentSchema, currentTable]);

  const customCellColumns = useMemo(
    () => new Set(onNavigateToTable && currentSchema && currentTable ? fkByColumn.keys() : []),
    [onNavigateToTable, currentSchema, currentTable, fkByColumn],
  );
  return { fkByColumn, outgoingFkByColumn, customCellColumns };
}

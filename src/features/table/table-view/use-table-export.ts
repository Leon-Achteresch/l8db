import { useHotkey } from "@tanstack/react-hotkeys";
import type { SortingState } from "@tanstack/react-table";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { useActiveConnection } from "@/lib/connections";
import { buildInsertStatements, UnsupportedValueError } from "@/lib/export";
import { onHotkeyAction, useResolvedHotkey } from "@/lib/hotkeys";
import { applyMasks, type ColumnMask } from "@/lib/masking";
import type { useTableRowsQuery } from "@/lib/queries";

type Options = {
  schema: string;
  table: string;
  filter: string;
  filterRaw: boolean;
  sorting: SortingState;
  isView: boolean;
  totalCount: number | null | undefined;
  data: ReturnType<typeof useTableRowsQuery>["data"];
  connection: ReturnType<typeof useActiveConnection>;
  masks?: ColumnMask[];
};

export function useTableExport({
  schema,
  table,
  filter,
  filterRaw,
  sorting,
  isView,
  totalCount,
  data,
  connection,
  masks = [],
}: Options) {
  const [exporting, setExporting] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [xlsxExportOpen, setXlsxExportOpen] = useState(false);
  const gridExportHotkey = useResolvedHotkey("grid.export");
  useHotkey(
    gridExportHotkey,
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      setCsvExportOpen(true);
    },
    { ignoreInputs: false },
  );
  useEffect(() => onHotkeyAction("grid.export", () => setCsvExportOpen(true)), []);

  const exportColumns = useMemo(
    () => (data?.columns ?? []).filter((c) => c !== "__ctid__"),
    [data],
  );

  const getExportRows = useCallback(() => {
    const cols = exportColumns;
    return (data?.rows ?? []).map((row) => {
      const source = row as Record<string, unknown>;
      const obj: Record<string, unknown> = {};
      for (const c of cols) obj[c] = source[c] ?? null;
      return obj;
    });
  }, [data, exportColumns]);
  const exportRows = useMemo(
    () => (csvExportOpen || xlsxExportOpen ? getExportRows() : []),
    [csvExportOpen, xlsxExportOpen, getExportRows],
  );

  const fullExportSource = useMemo(
    () => ({
      schema,
      table,
      filter,
      filterRaw,
      orderBy: sorting[0]?.id ?? null,
      orderDesc: sorting[0]?.desc ?? false,
      isView,
      totalRows: totalCount ?? null,
    }),
    [schema, table, filter, filterRaw, sorting, isView, totalCount],
  );

  const handleExport = async (format: "json" | "sql") => {
    if (!data) return;
    setExporting(true);
    try {
      const exportRows = applyMasks(exportColumns, getExportRows(), masks);
      const ext = format === "json" ? "json" : "sql";
      let content: string;
      if (format === "json") {
        content = JSON.stringify(exportRows, null, 2);
      } else {
        content = buildInsertStatements({
          schema,
          table,
          columns: exportColumns,
          rows: exportRows,
          kind: connection?.kind,
        });
      }
      const filePath = await save({
        defaultPath: `${table}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, content);
      toast.success(`Exportiert nach ${filePath.split("/").pop()}`);
    } catch (err) {
      if (err instanceof UnsupportedValueError) {
        toast.error(`Export abgebrochen – ${err.message}`);
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    csvExportOpen,
    setCsvExportOpen,
    xlsxExportOpen,
    setXlsxExportOpen,
    exportColumns,
    exportRows,
    fullExportSource,
    handleExport,
  };
}

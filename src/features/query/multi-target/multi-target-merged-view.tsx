import { useMemo } from "react";

import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { DataExportDialog } from "@/features/export/data-export-dialog";
import { XlsxExportDialog } from "@/features/export/xlsx-export-dialog";
import { QueryResultTable } from "@/features/query/query-result-table";
import { ResultActions } from "@/features/query/query-view/result-actions";
import { useResultExport } from "@/features/query/query-view/use-result-export";
import type { DatabaseKind } from "@/lib/db";
import { mergeResults, type TargetRun } from "@/lib/multi-target";

interface MultiTargetMergedViewProps {
  items: { id: string; label: string }[];
  runs: Record<string, TargetRun>;
  kind?: DatabaseKind;
  sql: string | null;
}

export function MultiTargetMergedView({ items, runs, kind, sql }: MultiTargetMergedViewProps) {
  const merged = useMemo(
    () =>
      mergeResults(
        items.flatMap((item) => {
          const result = runs[item.id]?.result;
          return result ? [{ label: item.label, result }] : [];
        }),
      ),
    [items, runs],
  );
  const result = merged.ok ? merged.result : null;
  const exportState = useResultExport(result);
  if (!merged.ok)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Zusammenführen nicht möglich. {merged.reason}
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex-1">
          {merged.result.rows.length.toLocaleString("de-DE")} Zeilen aus {merged.targets} Zielen,
          Spalte __target nennt das Ziel.
        </span>
        <ResultActions
          result={merged.result}
          serverOutput={false}
          outputOpen={false}
          connected
          onToggleOutput={() => undefined}
          exportState={exportState}
          sql={sql ?? undefined}
        />
      </div>
      <div className="min-h-0 flex-1" data-multi-target-grid>
        <QueryResultTable result={merged.result} isLoading={false} error={null} kind={kind} />
      </div>
      <XlsxExportDialog
        open={exportState.xlsxExportOpen}
        onOpenChange={exportState.setXlsxExportOpen}
        columns={merged.result.columns}
        rows={exportState.exportRows}
        defaultFileName="multi-target-result.xlsx"
      />
      <DataExportDialog
        format={exportState.dataExportFormat}
        onClose={() => exportState.setDataExportFormat(null)}
        columns={merged.result.columns}
        rows={exportState.exportRows}
        baseFileName="multi-target-result"
      />
      <CsvExportDialog
        open={exportState.csvExportOpen}
        onOpenChange={exportState.setCsvExportOpen}
        columns={merged.result.columns}
        rows={exportState.exportRows}
        defaultFileName="multi-target-result.csv"
      />
    </div>
  );
}

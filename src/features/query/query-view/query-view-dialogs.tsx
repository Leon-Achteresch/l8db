import type { RefObject } from "react";

import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { XlsxExportDialog } from "@/features/export/xlsx-export-dialog";
import { BindParamsDialog } from "@/features/query/bind-params-dialog";
import { ExplainPlanView } from "@/features/query/explain-plan-view";
import { QueryAnalysisSheet } from "@/features/query/query-analysis-sheet";
import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { QueryPerfPanel } from "@/features/query/query-perf-panel";
import { SaveQueryDialog } from "@/features/query/save-query-dialog";
import { ScriptRunDialog } from "@/features/query/script-run-dialog";
import { SnippetManagerDialog } from "@/features/query/snippet-manager-dialog";
import { TabSearchDialog } from "@/features/query/tab-search-dialog";
import type { QueryResult } from "@/lib/db";
import { useSavedQueriesStore } from "@/lib/saved-queries";

import type { AnalysisSection, QueryViewCapabilities, QueryViewConnection } from "./types";
import type { ExplainPlanState } from "./use-explain-plan";
import type { ResultExportState } from "./use-result-export";
import type { useRunSql } from "./use-run-sql";
import type { ScriptRunState } from "./use-script-run";

interface DialogState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface QueryViewDialogsProps {
  tabId: string;
  sql: string;
  selectedSql: string;
  connection: QueryViewConnection;
  database: string | null;
  caps: QueryViewCapabilities;
  isRunning: boolean;
  result: QueryResult | null;
  editorApiRef: RefObject<QueryEditorApi | null>;
  saveDialog: DialogState;
  snippetDialog: DialogState;
  tabSearch: DialogState;
  bind: ReturnType<typeof useRunSql>["bind"];
  script: ScriptRunState;
  exportState: ResultExportState;
  analysis: DialogState & {
    section: AnalysisSection;
    onSectionChange: (section: AnalysisSection) => void;
  };
  explain: ExplainPlanState;
}

export function QueryViewDialogs({
  tabId,
  sql,
  selectedSql,
  connection,
  database,
  caps,
  isRunning,
  result,
  editorApiRef,
  saveDialog,
  snippetDialog,
  tabSearch,
  bind,
  script,
  exportState,
  analysis,
  explain,
}: QueryViewDialogsProps) {
  const saveQuery = useSavedQueriesStore((state) => state.saveQuery);
  return (
    <>
      <SaveQueryDialog
        open={saveDialog.open}
        onOpenChange={saveDialog.onOpenChange}
        onSave={(name) => saveQuery(name, sql)}
      />

      <SnippetManagerDialog
        open={snippetDialog.open}
        onOpenChange={snippetDialog.onOpenChange}
        initialBody={selectedSql}
        onInsert={(snippet) => {
          snippetDialog.onOpenChange(false);
          editorApiRef.current?.insertSnippet(snippet.body);
        }}
      />

      <BindParamsDialog
        open={bind.open}
        onOpenChange={bind.onOpenChange}
        refs={bind.refs}
        values={bind.values}
        onValuesChange={bind.onValuesChange}
        onConfirm={bind.onConfirm}
        inline={!caps.bind_parameters}
      />

      <ScriptRunDialog
        open={script.scriptDialogOpen}
        onOpenChange={script.setScriptDialogOpen}
        statementCount={script.scriptSplit.statements.length}
        mode={script.scriptMode}
        unterminated={script.scriptSplit.unterminated}
        transactions={caps.transactions}
        onConfirm={(mode, stopOnError) => {
          script.setScriptDialogOpen(false);
          void script.runScript(mode, stopOnError);
        }}
      />

      <TabSearchDialog
        open={tabSearch.open}
        onOpenChange={tabSearch.onOpenChange}
        initialQuery={selectedSql}
        currentTabId={tabId}
      />

      <XlsxExportDialog
        open={exportState.xlsxExportOpen}
        onOpenChange={exportState.setXlsxExportOpen}
        columns={result?.columns ?? []}
        rows={exportState.exportRows}
        defaultFileName="query-result.xlsx"
      />

      <CsvExportDialog
        open={exportState.csvExportOpen}
        onOpenChange={exportState.setCsvExportOpen}
        columns={result?.columns ?? []}
        rows={exportState.exportRows}
        defaultFileName="query-result.csv"
      />

      <QueryAnalysisSheet
        open={analysis.open}
        onOpenChange={analysis.onOpenChange}
        explainSupported={caps.explain}
        section={analysis.section}
        onSectionChange={analysis.onSectionChange}
        explainEnabled={Boolean(connection) && !isRunning && sql.trim().length > 0}
        onExplain={(analyze) => {
          analysis.onSectionChange("plan");
          void explain.handleExplain(analyze);
        }}
        planLoading={explain.planLoading}
        planError={explain.planError}
        onPlanErrorDismiss={() => explain.setPlanError(null)}
        plan={
          explain.plan ? (
            <ExplainPlanView
              plan={explain.plan.node}
              analyzed={explain.plan.analyzed}
              sql={explain.plan.sql}
              connectionName={connection?.name ?? ""}
              databaseKind={connection?.kind ?? ""}
              database={database}
              onClose={() => explain.setPlan(null)}
            />
          ) : null
        }
        perf={
          <QueryPerfPanel
            sql={selectedSql.trim() ? selectedSql : sql}
            onClose={() => analysis.onSectionChange("plan")}
          />
        }
      />
    </>
  );
}

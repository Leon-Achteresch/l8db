import { motion } from "motion/react";
import { useRef, useState } from "react";
import { useGroupRef } from "react-resizable-panels";

import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { QuerySchemaBrowser } from "@/features/query/query-schema-browser";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useCapabilities } from "@/lib/providers";
import { useQueryWorkspace } from "@/lib/query-workspace";

import { ExternalChangeBanner } from "./query-view/external-change-banner";
import { QueryEditorContent } from "./query-view/query-editor-content";
import { QueryResultsContent } from "./query-view/query-results-content";
import { QueryToolsMenu } from "./query-view/query-tools-menu";
import { QueryViewDialogs } from "./query-view/query-view-dialogs";
import { QueryViewDrawers } from "./query-view/query-view-drawers";
import { QueryWorkspacePanels } from "./query-view/query-workspace-panels";
import { ResultActions } from "./query-view/result-actions";
import { buildStatusText, runLabelFor } from "./query-view/result-text";
import { RunControls } from "./query-view/run-controls";
import { ToolbarViewControls } from "./query-view/toolbar-view-controls";
import { useAnalysisSheet } from "./query-view/use-analysis-sheet";
import { useEditorCursorState } from "./query-view/use-editor-cursor-state";
import { useExplainPlan } from "./query-view/use-explain-plan";
import { useQueryExecutionState } from "./query-view/use-query-execution-state";
import { useQueryFileActions } from "./query-view/use-query-file-actions";
import { useQueryRegistry } from "./query-view/use-query-registry";
import { useQueryTabBookmarks, useQueryTabSql } from "./query-view/use-query-tab-state";
import { useQueryViewHotkeys } from "./query-view/use-query-view-hotkeys";
import { useResetOnTabChange } from "./query-view/use-reset-on-tab-change";
import { useResultExport } from "./query-view/use-result-export";
import { useRevealRequest } from "./query-view/use-reveal-request";
import { useRunActions } from "./query-view/use-run-actions";
import { useRunSql } from "./query-view/use-run-sql";
import { useScriptRun } from "./query-view/use-script-run";
import { useServerOutput } from "./query-view/use-server-output";
import { useWorkspaceLayoutSync } from "./query-view/use-workspace-layout-sync";

interface QueryViewProps {
  tabId: string;
}

export function QueryView({ tabId }: QueryViewProps) {
  const workspace = useQueryWorkspace();
  const workspaceGroup = useGroupRef();
  const [editorFocus, setEditorFocus] = useState(false);
  useWorkspaceLayoutSync(workspaceGroup, workspace, editorFocus);
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const { sql, updateQuerySql, markQueryTabExecuted, filePath, fileDirty, externalChange } =
    useQueryTabSql(tabId);
  const file = useQueryFileActions(tabId, filePath);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [snippetDialogOpen, setSnippetDialogOpen] = useState(false);
  const editorApiRef = useRef<QueryEditorApi | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const exec = useQueryExecutionState();
  const exportState = useResultExport(exec.result);
  const cursor = useEditorCursorState(sql);
  const bookmarks = useQueryTabBookmarks(tabId);
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const analysis = useAnalysisSheet();
  useResetOnTabChange(tabId, cursor, exec);
  useRevealRequest(tabId, editorApiRef);

  const caps = useCapabilities(connection?.kind);
  const schema = useQueryRegistry(connection, database, caps);
  const output = useServerOutput(connection, database, caps);

  const { runSql, bind } = useRunSql({
    tabId,
    sql,
    connection,
    database,
    caps,
    exec,
    cursor,
    markQueryTabExecuted,
    setEditorFocus,
    collectOutput: output.collectOutput,
  });

  const actions = useRunActions({
    sql,
    connection,
    database,
    workspace,
    exec,
    cursor,
    runSql,
    setEditorFocus,
  });

  const hasSelection = cursor.selectedSql.trim().length > 0;

  const shortcutLabel = useQueryViewHotkeys({
    actions,
    connected: connection !== null,
    editorApiRef,
    handleFileSave: file.handleFileSave,
    toggleHistory: () => setHistoryOpen((open) => !open),
    openCsvExport: exportState.openCsvExport,
  });

  const script = useScriptRun({
    sql,
    connection,
    database,
    caps,
    exec,
    editorApiRef,
    setEditorFocus,
    collectOutput: output.collectOutput,
  });

  const explain = useExplainPlan({
    sql,
    selectedSql: cursor.selectedSql,
    cursorOffset: cursor.cursorOffset,
    connection,
    database,
    workspace,
  });

  const runLabel = runLabelFor(workspace.runTarget, hasSelection);
  const statusText = buildStatusText(exec.result);
  const isSql = caps.query_language === "sql";

  const resultActions = (
    <ResultActions
      result={exec.result}
      serverOutput={caps.server_output}
      outputOpen={output.outputOpen}
      connected={Boolean(connection)}
      onToggleOutput={() => output.setOutputOpen((open) => !open)}
      exportState={exportState}
    />
  );

  return (
    <div className="flex h-full w-full min-h-0">
      <motion.div
        layout
        transition={{ layout: SPRING_LAYOUT }}
        className="flex h-full min-w-0 flex-1 flex-col"
      >
        <div
          className="flex min-h-12 shrink-0 flex-wrap items-center gap-1.5 border-b bg-card px-3 py-2"
          data-tour="query-toolbar"
        >
          <RunControls
            actions={actions}
            exec={exec}
            runLabel={runLabel}
            hasSelection={hasSelection}
            connected={Boolean(connection)}
            hasSql={Boolean(sql.trim())}
            showScript={isSql}
            statementCount={script.scriptSplit.statements.length}
            onOpenScript={script.handleOpenScriptDialog}
            shortcutLabel={shortcutLabel}
          />
          <ToolbarViewControls
            workspace={workspace}
            isSql={isSql}
            explain={caps.explain}
            analysisOpen={analysis.open}
            onOpenAnalysis={() => analysis.openAnalysis("plan")}
            editorFocus={editorFocus}
            onEditorFocusChange={setEditorFocus}
            toolsMenu={
              <QueryToolsMenu
                editorApiRef={editorApiRef}
                shortcutLabel={shortcutLabel}
                hasSql={Boolean(sql.trim())}
                connected={Boolean(connection)}
                isSql={isSql}
                serverOutput={caps.server_output}
                bookmarkCount={bookmarks.normalizedBookmarks.length}
                filePath={filePath}
                isRunning={exec.isRunning}
                onOpenHistory={() => setHistoryOpen(true)}
                onOpenOutput={() => output.setOutputOpen(true)}
                onOpenSave={() => setSaveDialogOpen(true)}
                onOpenSnippets={() => setSnippetDialogOpen(true)}
                onOpenTabSearch={() => setTabSearchOpen(true)}
                onClearBookmarks={() => bookmarks.clearQueryBookmarks(tabId)}
                onFileOpen={() => void file.handleFileOpen()}
                onFileSave={(saveAs) => void file.handleFileSave(saveAs)}
                onClearEditor={() => {
                  exec.setResultState(null);
                  exec.setError(null);
                  updateQuerySql(tabId, "");
                }}
              />
            }
          />
        </div>

        {externalChange && (
          <ExternalChangeBanner
            fileDirty={fileDirty}
            fileBusy={file.fileBusy}
            onReload={() => void file.reloadFromFile()}
            onKeepLocal={() => void file.keepLocal()}
          />
        )}

        <QueryWorkspacePanels
          workspace={workspace}
          workspaceGroup={workspaceGroup}
          editorFocus={editorFocus}
          navigator={
            workspace.navigatorVisible &&
            isSql &&
            connection && (
              <QuerySchemaBrowser
                tables={schema.registry.tables}
                columns={schema.registry.columns}
                kind={connection.kind}
                sql={sql}
                loading={schema.loading}
                error={schema.error}
                onRefresh={schema.refresh}
                onInsert={(text) => editorApiRef.current?.insertText(text)}
                onJump={(line, column) => editorApiRef.current?.revealMatch(line, column)}
                onClose={() => workspace.update({ navigatorVisible: false })}
              />
            )
          }
          editor={
            <QueryEditorContent
              tabId={tabId}
              sql={sql}
              caps={caps}
              editorApiRef={editorApiRef}
              actions={actions}
              exec={exec}
              cursor={cursor}
              bookmarks={bookmarks}
              registry={schema.registry}
              statusVisible={workspace.statusVisible}
              statementCount={script.scriptSplit.statements.length}
              dialectLabel={schema.dialectLabel}
              onSqlChange={updateQuerySql}
              onSave={() => void file.handleFileSave(false)}
              onSearchTabs={() => setTabSearchOpen(true)}
            />
          }
          results={
            <QueryResultsContent
              exec={exec}
              kind={connection?.kind}
              statusText={statusText}
              actions={resultActions}
            />
          }
        />

        <QueryViewDialogs
          tabId={tabId}
          sql={sql}
          selectedSql={cursor.selectedSql}
          connection={connection}
          database={database}
          caps={caps}
          isRunning={exec.isRunning}
          result={exec.result}
          editorApiRef={editorApiRef}
          saveDialog={{ open: saveDialogOpen, onOpenChange: setSaveDialogOpen }}
          snippetDialog={{ open: snippetDialogOpen, onOpenChange: setSnippetDialogOpen }}
          tabSearch={{ open: tabSearchOpen, onOpenChange: setTabSearchOpen }}
          bind={bind}
          script={script}
          exportState={exportState}
          analysis={analysis}
          explain={explain}
        />

        <QueryViewDrawers
          connection={connection}
          caps={caps}
          output={output}
          exec={exec}
          onSelectScriptEntry={script.handleSelectScriptEntry}
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
          tabId={tabId}
          onReplaceSql={updateQuerySql}
        />
      </motion.div>
    </div>
  );
}

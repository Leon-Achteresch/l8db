import { useHotkeys } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangleIcon,
  BookmarkIcon,
  BookmarkPlusIcon,
  Columns2Icon,
  DownloadIcon,
  FileIcon,
  GaugeIcon,
  HistoryIcon,
  ListOrderedIcon,
  LoaderIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelBottomIcon,
  PanelLeftIcon,
  PlayIcon,
  ScanTextIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  TextSelectIcon,
  TimerIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGroupRef } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { XlsxExportDialog } from "@/features/export/xlsx-export-dialog";
import { BindParamsDialog } from "@/features/query/bind-params-dialog";
import { ExplainPlanView } from "@/features/query/explain-plan-view";
import { QueryEditorOutline } from "@/features/query/query-editor-outline";
import { type QueryEditorApi, QueryEditorPane } from "@/features/query/query-editor-pane";
import { QueryEditorSettingsPopover } from "@/features/query/query-editor-settings-popover";
import { QueryEditorStatusbar } from "@/features/query/query-editor-statusbar";
import { QueryHistoryPanel } from "@/features/query/query-history-panel";
import { QueryPerfPanel } from "@/features/query/query-perf-panel";
import { QueryResultWorkbench } from "@/features/query/query-result-workbench";
import { QuerySchemaBrowser } from "@/features/query/query-schema-browser";
import { SaveQueryDialog } from "@/features/query/save-query-dialog";
import { ScriptResultList, type ScriptRunEntry } from "@/features/query/script-result-list";
import { ScriptRunDialog, type ScriptRunMode } from "@/features/query/script-run-dialog";
import { SnippetManagerDialog } from "@/features/query/snippet-manager-dialog";
import { SnippetMenu } from "@/features/query/snippet-menu";
import { TabSearchDialog } from "@/features/query/tab-search-dialog";
import {
  type BindParamRef,
  type BindParamValue,
  buildParameterizedQuery,
  detectBindParams,
  type ParameterizedQuery,
} from "@/lib/bind-params";
import { useActiveConnection } from "@/lib/connections";
import {
  beginTransaction,
  type ExplainNode,
  executeInTransaction,
  executeInTransactionWithParams,
  executeQuery,
  executeQueryWithParams,
  explainQuery,
  listAllColumns,
  listTables,
  type QueryResult,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { openSqlFileAsTab, useQueryFile } from "@/lib/hooks/use-query-file";
import {
  commandById,
  formatHotkeyDisplay,
  onHotkeyAction,
  resolveHotkey,
  useHotkeysStore,
} from "@/lib/hotkeys";
import { useCapabilities } from "@/lib/providers";
import { useSchemasQuery } from "@/lib/queries";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useQueryRevealStore } from "@/lib/query-reveal";
import { resolveQueryRunTarget } from "@/lib/query-run-target";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { collectServerOutput, toggleServerOutput, useServerOutputStore } from "@/lib/server-output";
import { useSettingsStore } from "@/lib/settings";
import { sqlDialectForKind, sqlDialectLabel } from "@/lib/sql-format";
import { splitSqlStatements, statementAtOffset } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import { isQueryTabDirty, normalizeBookmarks, useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection, useTransactionStore } from "@/lib/transactions";
import { ServerOutputPanel } from "./server-output-panel";

const QUERY_LANGUAGES = {
  sql: "SQL",
  cql: "CQL",
  json: "MongoDB-Befehle als JSON",
  redis: "Redis-Befehle, eine pro Zeile",
} as const;

const EMPTY_BOOKMARKS: number[] = [];

const SCRIPT_MODE_NOTE: Record<ScriptRunMode, string> = {
  "existing-transaction": "läuft in offener Transaktion, kein Autocommit",
  "new-transaction": "verwaltete Transaktion, Commit über Transaktionspanel",
  autocommit: "Autocommit je Statement",
};

const DML_PATTERN = /^(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;

interface QueryViewProps {
  tabId: string;
}

export function QueryView({ tabId }: QueryViewProps) {
  const workspace = useQueryWorkspace();
  const workspaceGroup = useGroupRef();
  const [editorFocus, setEditorFocus] = useState(false);
  useEffect(() => {
    if (editorFocus) return;
    const group = workspaceGroup.current;
    const layout = group?.getLayout();
    if (
      group &&
      layout?.editor !== undefined &&
      layout.results !== undefined &&
      Math.abs(layout.editor - workspace.editorShare) > 0.1
    ) {
      group.setLayout({ editor: workspace.editorShare, results: 100 - workspace.editorShare });
    }
  }, [workspace.editorShare, workspace.layout, editorFocus, workspaceGroup]);
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const navigate = useNavigate();

  const sql = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? tab.sql : "";
  });
  const updateQuerySql = useTableTabs((state) => state.updateQuerySql);
  const filePath = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? (tab.filePath ?? null) : null;
  });
  const fileDirty = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? isQueryTabDirty(tab) : false;
  });
  const externalChange = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? Boolean(tab.externalChange) : false;
  });
  const { saveToFile, reloadFromFile, keepLocal, checkExternal } = useQueryFile(tabId);
  const [fileBusy, setFileBusy] = useState(false);

  useEffect(() => {
    if (!filePath) return;
    void checkExternal();
    const onFocus = () => void checkExternal();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [filePath, checkExternal]);

  const handleFileSave = useCallback(
    async (saveAs: boolean) => {
      if (fileBusy) return;
      setFileBusy(true);
      try {
        await saveToFile(saveAs);
      } finally {
        setFileBusy(false);
      }
    },
    [fileBusy, saveToFile],
  );

  const handleFileOpen = useCallback(async () => {
    if (fileBusy) return;
    setFileBusy(true);
    try {
      const id = await openSqlFileAsTab();
      if (id) void navigate({ to: "/query/$id", params: { id } });
    } finally {
      setFileBusy(false);
    }
  }, [fileBusy, navigate]);

  const saveQuery = useSavedQueriesStore((state) => state.saveQuery);
  const recordHistory = useQueryHistoryStore((state) => state.record);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [snippetDialogOpen, setSnippetDialogOpen] = useState(false);
  const editorApiRef = useRef<QueryEditorApi | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [xlsxExportOpen, setXlsxExportOpen] = useState(false);
  const [plan, setPlan] = useState<{
    node: ExplainNode;
    analyzed: boolean;
    sql: string;
  } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);

  const [selectedSql, setSelectedSql] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1, offset: 0 });
  const [statementRange, setStatementRange] = useState<{ start: number; end: number } | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);

  const bookmarks = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? (tab.bookmarks ?? EMPTY_BOOKMARKS) : EMPTY_BOOKMARKS;
  });
  const setQueryBookmarks = useTableTabs((state) => state.setQueryBookmarks);
  const clearQueryBookmarks = useTableTabs((state) => state.clearQueryBookmarks);
  const normalizedBookmarks = useMemo(() => normalizeBookmarks(bookmarks), [bookmarks]);

  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [bindRefs, setBindRefs] = useState<BindParamRef[]>([]);
  const [bindPendingSql, setBindPendingSql] = useState<string | null>(null);
  const [bindValues, setBindValues] = useState<Record<string, BindParamValue>>({});
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const outputEnabled = useServerOutputStore((state) =>
    connection ? state.enabled[connection.id] === true : false,
  );
  const outputCount = useServerOutputStore((state) =>
    connection ? (state.entries[connection.id]?.length ?? 0) : 0,
  );
  const [scriptMode, setScriptMode] = useState<ScriptRunMode>("autocommit");
  const [scriptEntries, setScriptEntries] = useState<ScriptRunEntry[] | null>(null);
  const [scriptActiveIndex, setScriptActiveIndex] = useState<number | null>(null);
  const [scriptNote, setScriptNote] = useState("");

  const revealRequest = useQueryRevealStore((state) => state.request);
  const clearReveal = useQueryRevealStore((state) => state.clearReveal);

  useEffect(() => {
    setSelectedSql("");
    setCursorOffset(0);
    setCursorPosition({ line: 1, column: 1, offset: 0 });
    setStatementRange(null);
    setStatementError(null);
    setScriptEntries(null);
    setScriptActiveIndex(null);
  }, [tabId]);

  useEffect(() => {
    if (!revealRequest || revealRequest.tabId !== tabId) return;
    const timer = setTimeout(() => {
      editorApiRef.current?.revealMatch(
        revealRequest.line,
        revealRequest.column,
        revealRequest.length,
      );
      clearReveal(tabId);
    }, 0);
    return () => clearTimeout(timer);
  }, [revealRequest, tabId, clearReveal]);

  const { data: schemas } = useSchemasQuery();

  const {
    data: tables,
    isFetching: tablesLoading,
    isError: tablesError,
    refetch: refreshTables,
  } = useQuery({
    queryKey: ["all-tables", connection?.id, database],
    queryFn: () =>
      listTables(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: Boolean(connection),
  });

  const {
    data: columns,
    isFetching: columnsLoading,
    isError: columnsError,
    refetch: refreshColumns,
  } = useQuery({
    queryKey: ["all-columns", connection?.id, database],
    queryFn: () =>
      listAllColumns(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: Boolean(connection),
    staleTime: 60_000,
  });

  const registry = useMemo(
    () => ({ schemas: schemas ?? [], tables: tables ?? [], columns: columns ?? [] }),
    [schemas, tables, columns],
  );

  const caps = useCapabilities(connection?.kind);

  const dialectLabel = useMemo(
    () =>
      caps.query_language === "json"
        ? "MongoDB JSON"
        : sqlDialectLabel(sqlDialectForKind(connection?.kind)),
    [connection?.kind, caps.query_language],
  );

  const collectOutput = useCallback(async () => {
    if (!connection || !caps.server_output) return;
    try {
      await collectServerOutput(
        connection.kind,
        effectiveConnectionString(connection),
        connection.id,
        database ?? undefined,
      );
    } catch {
      return;
    }
  }, [connection, database, caps.server_output]);

  const handleToggleServerOutput = useCallback(
    async (enabled: boolean) => {
      if (!connection) return;
      setOutputBusy(true);
      try {
        await toggleServerOutput(
          connection.kind,
          effectiveConnectionString(connection),
          connection.id,
          enabled,
          database ?? undefined,
        );
      } catch (err) {
        toast.error(String(err));
      } finally {
        setOutputBusy(false);
      }
    },
    [connection, database],
  );

  const runSql = useCallback(
    async (text: string, bound?: ParameterizedQuery) => {
      const sql = text;
      if (!connection || !sql.trim() || runningRef.current) return;
      if (!bound && caps.bind_parameters) {
        const refs = detectBindParams(sql);
        if (refs.length > 0) {
          setBindValues((previous) => {
            const next: Record<string, BindParamValue> = {};
            for (const ref of refs) {
              next[ref.name] = previous[ref.name] ?? { type: "text", value: "" };
            }
            return next;
          });
          setBindRefs(refs);
          setBindPendingSql(sql);
          setBindDialogOpen(true);
          return;
        }
      }
      setEditorFocus(false);
      runningRef.current = true;
      setIsRunning(true);
      setScriptEntries(null);
      setScriptActiveIndex(null);
      setError(null);
      const startedAt = performance.now();
      const finishHistory = (outcome: { rowCount: number | null; error: string | null }) => {
        recordHistory({
          connectionId: connection.id,
          database: database ?? null,
          sql,
          durationMs: Math.round(performance.now() - startedAt),
          rowCount: outcome.rowCount,
          error: outcome.error ? outcome.error.slice(0, 500) : null,
        });
      };
      const rowCountOf = (res: QueryResult): number | null =>
        res.columns.length > 0
          ? res.rows.length
          : res.rows_affected != null
            ? Number(res.rows_affected)
            : null;
      try {
        const store = useTransactionStore.getState();
        const existingTx = getTransactionForConnection(connection.id);
        const isDml = DML_PATTERN.test(sql.trim());

        if (existingTx) {
          const res = bound
            ? await executeInTransactionWithParams(existingTx.txId, bound.sql, bound.values)
            : await executeInTransaction(existingTx.txId, sql);
          if (isDml) {
            store.addChange(existingTx.txId, {
              id: crypto.randomUUID(),
              type: "query",
              timestamp: Date.now(),
              sql,
              rowsAffected: res.rows_affected,
            });
            store.setPanelOpen(true);
          }
          setResult(res);
          finishHistory({ rowCount: rowCountOf(res), error: null });
        } else if (isDml && caps.transactions && useSettingsStore.getState().transactionsEnabled) {
          const txId = await beginTransaction(
            connection.kind,
            effectiveConnectionString(connection),
            database ?? undefined,
          );
          store.addTransaction({
            txId,
            connectionId: connection.id,
            connectionName: connection.name,
            database: database ?? undefined,
            changes: [],
            startedAt: Date.now(),
          });
          const res = bound
            ? await executeInTransactionWithParams(txId, bound.sql, bound.values)
            : await executeInTransaction(txId, sql);
          store.addChange(txId, {
            id: crypto.randomUUID(),
            type: "query",
            timestamp: Date.now(),
            sql,
            rowsAffected: res.rows_affected,
          });
          store.setPanelOpen(true);
          setResult(res);
          finishHistory({ rowCount: rowCountOf(res), error: null });
        } else {
          const res = bound
            ? await executeQueryWithParams(
                connection.kind,
                effectiveConnectionString(connection),
                bound.sql,
                bound.values,
                database ?? undefined,
              )
            : await executeQuery(
                connection.kind,
                effectiveConnectionString(connection),
                sql,
                database ?? undefined,
              );
          setResult(res);
          finishHistory({ rowCount: rowCountOf(res), error: null });
        }
      } catch (err) {
        const message = String(err);
        setError(message);
        setResult(null);
        finishHistory({ rowCount: null, error: message });
      } finally {
        await collectOutput();
        runningRef.current = false;
        setIsRunning(false);
      }
    },
    [connection, database, recordHistory, caps.transactions, caps.bind_parameters, collectOutput],
  );

  const handleBindConfirm = useCallback(() => {
    const pending = bindPendingSql;
    if (!pending) return;
    setBindDialogOpen(false);
    setBindPendingSql(null);
    void runSql(pending, buildParameterizedQuery(pending, bindValues));
  }, [bindPendingSql, bindValues, runSql]);

  const handleRun = useCallback(() => {
    setEditorFocus(false);
    setStatementRange(null);
    setStatementError(null);
    const target = resolveQueryRunTarget(
      sql,
      selectedSql,
      cursorOffset,
      workspace.runTarget,
      connection?.kind,
    );
    if (!target.trim()) {
      setStatementError("Kein ausführbares Statement an der Cursorposition.");
      return;
    }
    void runSql(target);
  }, [runSql, sql, selectedSql, cursorOffset, workspace.runTarget, connection?.kind]);

  const handleRunSelection = useCallback(() => {
    if (!selectedSql.trim()) return;
    setStatementRange(null);
    setStatementError(null);
    void runSql(selectedSql);
  }, [runSql, selectedSql]);

  const handleRunStatement = useCallback(() => {
    if (selectedSql.trim()) {
      handleRunSelection();
      return;
    }
    const statement = statementAtOffset(sql, cursorOffset, connection?.kind);
    if (!statement) {
      setStatementRange(null);
      setStatementError(
        "Statement unter dem Cursor konnte nicht eindeutig bestimmt werden. Bitte den gewünschten Bereich markieren.",
      );
      return;
    }
    setStatementError(null);
    setStatementRange({ start: statement.start, end: statement.end });
    void runSql(statement.text);
  }, [cursorOffset, handleRunSelection, runSql, selectedSql, sql, connection?.kind]);

  const hasSelection = selectedSql.trim().length > 0;

  const hotkeyOverrides = useHotkeysStore((state) => state.overrides);
  const shortcutLabel = (id: string) => formatHotkeyDisplay(resolveHotkey(id, hotkeyOverrides));

  useHotkeys(
    (["query.run", "query.runSelection", "query.runStatement"] as const).flatMap((id) => {
      const command = commandById(id);
      if (!command) return [];
      const skipMonaco = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        return Boolean(target?.closest?.(".monaco-editor"));
      };
      const runAction =
        id === "query.run"
          ? handleRun
          : id === "query.runSelection"
            ? handleRunSelection
            : handleRunStatement;
      const primary = (hotkeyOverrides[id] ?? command.defaultHotkey) as never;
      const rows = [
        {
          hotkey: primary,
          callback: (event: KeyboardEvent) => {
            if (skipMonaco(event)) return;
            runAction();
          },
          options: { enabled: connection !== null, ignoreInputs: false },
        },
      ];
      if (!hotkeyOverrides[id]) {
        for (const alias of command.aliases ?? []) {
          rows.push({
            hotkey: alias as never,
            callback: () => runAction(),
            options: { enabled: connection !== null, ignoreInputs: false },
          });
        }
      }
      return rows;
    }),
    { preventDefault: true, stopPropagation: true },
  );

  useHotkeys(
    [
      {
        hotkey: (hotkeyOverrides["query.save"] ??
          commandById("query.save")?.defaultHotkey ??
          "Mod+S") as never,
        callback: (event: KeyboardEvent) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".monaco-editor")) return;
          void handleFileSave(false);
        },
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["query.saveAs"] ??
          commandById("query.saveAs")?.defaultHotkey ??
          "Mod+Shift+S") as never,
        callback: () => void handleFileSave(true),
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["query.format"] ??
          commandById("query.format")?.defaultHotkey ??
          "Shift+Alt+F") as never,
        callback: (event: KeyboardEvent) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".monaco-editor")) return;
          editorApiRef.current?.format();
        },
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["query.comment"] ??
          commandById("query.comment")?.defaultHotkey ??
          "Mod+/") as never,
        callback: (event: KeyboardEvent) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".monaco-editor")) return;
          editorApiRef.current?.toggleComment();
        },
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["query.bookmark"] ??
          commandById("query.bookmark")?.defaultHotkey ??
          "Mod+Alt+B") as never,
        callback: (event: KeyboardEvent) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".monaco-editor")) return;
          editorApiRef.current?.toggleBookmark();
        },
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["query.nextBookmark"] ??
          commandById("query.nextBookmark")?.defaultHotkey ??
          "F2") as never,
        callback: (event: KeyboardEvent) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".monaco-editor")) return;
          editorApiRef.current?.gotoBookmark("next");
        },
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["query.prevBookmark"] ??
          commandById("query.prevBookmark")?.defaultHotkey ??
          "Shift+F2") as never,
        callback: (event: KeyboardEvent) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".monaco-editor")) return;
          editorApiRef.current?.gotoBookmark("previous");
        },
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["query.history"] ??
          commandById("query.history")?.defaultHotkey ??
          "Mod+H") as never,
        callback: () => setHistoryOpen((open) => !open),
        options: { ignoreInputs: false },
      },
      {
        hotkey: (hotkeyOverrides["grid.export"] ??
          commandById("grid.export")?.defaultHotkey ??
          "Mod+E") as never,
        callback: () => setCsvExportOpen(true),
        options: { enabled: connection !== null, ignoreInputs: false },
      },
    ],
    { preventDefault: true, stopPropagation: true },
  );

  useEffect(() => onHotkeyAction("query.run", handleRun), [handleRun]);
  useEffect(() => onHotkeyAction("query.runSelection", handleRunSelection), [handleRunSelection]);
  useEffect(() => onHotkeyAction("query.runStatement", handleRunStatement), [handleRunStatement]);
  useEffect(() => onHotkeyAction("query.save", () => void handleFileSave(false)), [handleFileSave]);
  useEffect(
    () => onHotkeyAction("query.saveAs", () => void handleFileSave(true)),
    [handleFileSave],
  );
  useEffect(() => onHotkeyAction("grid.export", () => setCsvExportOpen(true)), []);

  const scriptSplit = useMemo(
    () => splitSqlStatements(sql, connection?.kind),
    [sql, connection?.kind],
  );

  const handleOpenScriptDialog = useCallback(() => {
    if (!connection) return;
    const existingTx = getTransactionForConnection(connection.id);
    const hasDml = scriptSplit.statements.some((statement) =>
      DML_PATTERN.test(statement.text.trim()),
    );
    if (existingTx) setScriptMode("existing-transaction");
    else if (hasDml && caps.transactions && useSettingsStore.getState().transactionsEnabled)
      setScriptMode("new-transaction");
    else setScriptMode("autocommit");
    setScriptDialogOpen(true);
  }, [connection, caps.transactions, scriptSplit]);

  const runScript = useCallback(
    async (mode: ScriptRunMode) => {
      if (!connection || isRunning || runningRef.current) return;
      const statements = scriptSplit.statements;
      if (statements.length === 0) return;

      const entries: ScriptRunEntry[] = statements.map((statement, index) => ({
        index,
        sql: statement.text,
        start: statement.start,
        end: statement.end,
        status: "pending",
        durationMs: null,
        rowCount: null,
        rowsAffected: null,
        error: null,
      }));

      setScriptNote(SCRIPT_MODE_NOTE[mode]);
      setScriptEntries(entries.map((entry) => ({ ...entry })));
      setScriptActiveIndex(null);
      setStatementError(null);
      setStatementRange(null);
      setError(null);
      setEditorFocus(false);
      runningRef.current = true;
      setIsRunning(true);

      const store = useTransactionStore.getState();
      let txId = getTransactionForConnection(connection.id)?.txId ?? null;

      try {
        if (!txId && mode === "new-transaction") {
          txId = await beginTransaction(
            connection.kind,
            effectiveConnectionString(connection),
            database ?? undefined,
          );
          store.addTransaction({
            txId,
            connectionId: connection.id,
            connectionName: connection.name,
            database: database ?? undefined,
            changes: [],
            startedAt: Date.now(),
          });
          store.setPanelOpen(true);
        }
      } catch (err) {
        setError(String(err));
        runningRef.current = false;
        setIsRunning(false);
        return;
      }

      let lastResult: QueryResult | null = null;
      let failed = false;

      for (const entry of entries) {
        if (failed) {
          entry.status = "skipped";
          continue;
        }
        entry.status = "running";
        setScriptEntries(entries.map((item) => ({ ...item })));
        const startedAt = performance.now();
        try {
          const res = txId
            ? await executeInTransaction(txId, entry.sql)
            : await executeQuery(
                connection.kind,
                effectiveConnectionString(connection),
                entry.sql,
                database ?? undefined,
              );
          entry.status = "success";
          entry.durationMs = Math.round(performance.now() - startedAt);
          entry.rowCount = res.columns.length > 0 ? res.rows.length : null;
          entry.rowsAffected = res.rows_affected == null ? null : Number(res.rows_affected);
          lastResult = res;
          entry.result = res;
          if (txId && DML_PATTERN.test(entry.sql.trim())) {
            store.addChange(txId, {
              id: crypto.randomUUID(),
              type: "query",
              timestamp: Date.now(),
              sql: entry.sql,
              rowsAffected: res.rows_affected,
            });
          }
          recordHistory({
            connectionId: connection.id,
            database: database ?? null,
            sql: entry.sql,
            durationMs: entry.durationMs,
            rowCount: entry.rowCount ?? entry.rowsAffected,
            error: null,
          });
        } catch (err) {
          const message = String(err);
          entry.status = "error";
          entry.error = message;
          entry.durationMs = Math.round(performance.now() - startedAt);
          failed = true;
          setError(message);
          setStatementRange({ start: entry.start, end: entry.end });
          setScriptActiveIndex(entry.index);
          recordHistory({
            connectionId: connection.id,
            database: database ?? null,
            sql: entry.sql,
            durationMs: entry.durationMs,
            rowCount: null,
            error: message.slice(0, 500),
          });
        }
        setScriptEntries(entries.map((item) => ({ ...item })));
      }

      setScriptEntries(entries.map((item) => ({ ...item })));
      setResult(failed ? null : lastResult);
      if (!failed) setScriptActiveIndex(entries.length - 1);
      await collectOutput();
      runningRef.current = false;
      setIsRunning(false);
    },
    [connection, database, isRunning, recordHistory, scriptSplit, collectOutput],
  );

  const handleSelectScriptEntry = useCallback(
    (entry: ScriptRunEntry) => {
      setScriptActiveIndex(entry.index);
      if (!runningRef.current) {
        setResult(entry.result ?? null);
        setError(entry.error);
      }
      setStatementRange({ start: entry.start, end: entry.end });
      const before = sql.slice(0, entry.start).split("\n");
      editorApiRef.current?.revealMatch(before.length, before[before.length - 1].length + 1, 0);
    },
    [sql],
  );

  const handleExplain = useCallback(
    async (analyze: boolean) => {
      const target = resolveQueryRunTarget(
        sql,
        selectedSql,
        cursorOffset,
        workspace.runTarget,
        connection?.kind,
      );
      if (!connection || !target.trim() || planLoading) return;
      setPlanLoading(true);
      setPlanError(null);
      try {
        const plans = await explainQuery(
          connection.kind,
          effectiveConnectionString(connection),
          target,
          analyze,
          database ?? undefined,
        );
        const node = plans[0]?.Plan;
        if (!node) {
          setPlanError("Kein Ausführungsplan erhalten.");
          setPlan(null);
        } else {
          setPlan({ node, analyzed: analyze, sql: target });
        }
      } catch (err) {
        setPlanError(String(err));
        setPlan(null);
      } finally {
        setPlanLoading(false);
      }
    },
    [connection, sql, selectedSql, cursorOffset, workspace.runTarget, database, planLoading],
  );

  const exportRows = useMemo(() => {
    if (!result) return [] as Record<string, unknown>[];
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const c of result.columns) obj[c] = row[c] ?? null;
      return obj;
    });
  }, [result]);

  const handleExportJson = async () => {
    if (!result || result.columns.length === 0) return;
    setExporting(true);
    try {
      const filePath = await save({
        defaultPath: "query-result.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, JSON.stringify(exportRows, null, 2));
    } catch (error) {
      toast.error(`Export fehlgeschlagen: ${String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const runLabel =
    workspace.runTarget === "all"
      ? "Alles ausführen"
      : hasSelection
        ? "Auswahl ausführen"
        : workspace.runTarget === "selection-or-statement"
          ? "Statement ausführen"
          : "Ausführen";

  const statusText = (() => {
    if (!result) return null;
    const parts: string[] = [];
    if (result.columns.length > 0) {
      parts.push(`${result.rows.length} Zeile${result.rows.length === 1 ? "" : "n"}`);
    }
    if (
      result.rows_affected !== null &&
      result.rows_affected !== undefined &&
      result.columns.length === 0
    ) {
      parts.push(`${result.rows_affected} betroffen`);
    }
    parts.push(`${result.execution_time_ms} ms`);
    return parts.join(" · ");
  })();

  return (
    <div className="flex h-full w-full min-h-0">
      <motion.div
        layout
        transition={{ layout: SPRING_LAYOUT }}
        className="flex h-full min-w-0 flex-1 flex-col"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/20 px-4 text-xs">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <TerminalIcon className="size-3.5" />
            Query Studio
          </span>
          <span className="mx-1 h-3 w-px bg-border" />
          <span className="size-1.5 shrink-0 rounded-full bg-current text-muted-foreground" />
          <span className="truncate text-muted-foreground">
            {connection?.name ?? "Keine Verbindung"}
            {database ? ` / ${database}` : ""}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
            {dialectLabel}
          </span>
        </div>
        <div
          className="flex min-h-12 shrink-0 flex-wrap items-center gap-1.5 border-b bg-card px-3 py-2"
          data-tour="query-toolbar"
        >
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1.5 px-3 text-xs"
            data-tour="query-run"
            onClick={handleRun}
            disabled={isRunning || !connection || !sql.trim()}
            title={`${runLabel} (${shortcutLabel("query.run")})`}
          >
            {hasSelection ? <TextSelectIcon className="size-3" /> : <PlayIcon className="size-3" />}
            {runLabel}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-3 text-xs"
            data-tour="query-run-statement"
            onClick={handleRunStatement}
            disabled={isRunning || !connection || !sql.trim()}
            title={`Statement unter dem Cursor ausführen (${shortcutLabel("query.runStatement")})`}
          >
            <ScanTextIcon className="size-3" />
            Statement
          </Button>
          {caps.query_language === "sql" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-3 text-xs"
              onClick={handleOpenScriptDialog}
              disabled={isRunning || !connection || scriptSplit.statements.length === 0}
              title="Alle Statements nacheinander ausführen und Einzelergebnisse anzeigen"
            >
              <ListOrderedIcon className="size-3" />
              Skript
            </Button>
          )}
          {caps.query_language === "sql" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-3 text-xs"
              onClick={() => editorApiRef.current?.format()}
              disabled={!sql.trim()}
              title={`SQL formatieren (${shortcutLabel("query.format")})`}
            >
              <WandSparklesIcon className="size-3" />
              Formatieren
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {caps.query_language === "sql" && (
              <Button
                size="icon-sm"
                variant={workspace.navigatorVisible ? "secondary" : "ghost"}
                aria-label="Schema-Navigator umschalten"
                title="Schema und Statement-Navigator"
                aria-pressed={workspace.navigatorVisible}
                onClick={() => workspace.update({ navigatorVisible: !workspace.navigatorVisible })}
              >
                <PanelLeftIcon className="size-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              variant={workspace.toolsVisible ? "secondary" : "ghost"}
              className="h-7 gap-1.5 text-xs"
              aria-pressed={workspace.toolsVisible}
              onClick={() => workspace.update({ toolsVisible: !workspace.toolsVisible })}
            >
              <SlidersHorizontalIcon className="size-3.5" />
              Werkzeuge
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title={
                workspace.layout === "vertical"
                  ? "Ergebnisse rechts anzeigen"
                  : "Ergebnisse unten anzeigen"
              }
              aria-label="Aufteilung wechseln"
              onClick={() =>
                workspace.update({
                  layout: workspace.layout === "vertical" ? "horizontal" : "vertical",
                })
              }
            >
              {workspace.layout === "vertical" ? (
                <Columns2Icon className="size-3.5" />
              ) : (
                <PanelBottomIcon className="size-3.5" />
              )}
            </Button>
            <Button
              size="icon-sm"
              variant={editorFocus ? "secondary" : "ghost"}
              title="Editor-Fokus umschalten"
              aria-label="Editor-Fokus umschalten"
              aria-pressed={editorFocus}
              onClick={() => setEditorFocus(!editorFocus)}
            >
              {editorFocus ? (
                <Minimize2Icon className="size-3.5" />
              ) : (
                <Maximize2Icon className="size-3.5" />
              )}
            </Button>
            <QueryEditorSettingsPopover />
          </div>
          {!connection && (
            <span className="ml-2 text-xs text-muted-foreground">Keine Verbindung aktiv</span>
          )}
          {connection && caps.query_language !== "sql" && (
            <span className="ml-2 text-xs text-muted-foreground">
              {QUERY_LANGUAGES[caps.query_language]}
            </span>
          )}
        </div>
        {workspace.toolsVisible && (
          <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b bg-muted/20 px-3 py-1.5">
            {workspace.navigationTools && (
              <>
                <QueryEditorOutline
                  sql={sql}
                  dialect={connection?.kind}
                  onJump={(line, column) => editorApiRef.current?.revealMatch(line, column, 0)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={() => setTabSearchOpen(true)}
                  title="In allen offenen Query-Tabs suchen (Cmd/Ctrl+Shift+F)"
                >
                  <SearchIcon className="size-3" />
                  Suchen
                </Button>
                {caps.server_output && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-3 text-xs"
                    onClick={() => setOutputOpen((open) => !open)}
                    disabled={!connection}
                    title="Server-Ausgabe (Notices, DBMS_OUTPUT) anzeigen"
                  >
                    <TerminalIcon className="size-3" />
                    Ausgabe
                    {outputCount > 0 && (
                      <span className="tabular-nums text-muted-foreground">{outputCount}</span>
                    )}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-3 text-xs"
                      title="Lesezeichen setzen und anspringen"
                    >
                      <BookmarkPlusIcon className="size-3" />
                      Lesezeichen
                      {normalizedBookmarks.length > 0 && (
                        <span className="tabular-nums text-muted-foreground">
                          {normalizedBookmarks.length}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => editorApiRef.current?.toggleBookmark()}>
                      {`Lesezeichen setzen/entfernen (${shortcutLabel("query.bookmark")})`}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => editorApiRef.current?.gotoBookmark("next")}
                      disabled={normalizedBookmarks.length === 0}
                    >
                      {`Nächstes Lesezeichen (${shortcutLabel("query.nextBookmark")})`}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => editorApiRef.current?.gotoBookmark("previous")}
                      disabled={normalizedBookmarks.length === 0}
                    >
                      {`Vorheriges Lesezeichen (${shortcutLabel("query.prevBookmark")})`}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => clearQueryBookmarks(tabId)}
                      disabled={normalizedBookmarks.length === 0}
                    >
                      Alle Lesezeichen entfernen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {workspace.fileTools && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={() => setSaveDialogOpen(true)}
                  disabled={!sql.trim()}
                >
                  <BookmarkIcon className="size-3" />
                  Speichern
                </Button>
                <SnippetMenu
                  onInsert={(snippet) => editorApiRef.current?.insertSnippet(snippet.body)}
                  onManage={() => setSnippetDialogOpen(true)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-3 text-xs"
                      disabled={fileBusy}
                      title={filePath ?? "SQL-Datei öffnen oder speichern"}
                    >
                      {fileBusy ? (
                        <LoaderIcon className="size-3 animate-spin" />
                      ) : (
                        <FileIcon className="size-3" />
                      )}
                      Datei
                      {fileDirty && <span className="text-amber-500">●</span>}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => void handleFileOpen()}>
                      SQL-Datei öffnen…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void handleFileSave(false)}
                      disabled={!sql.trim() && !filePath}
                    >
                      {filePath ? "Speichern" : "Speichern unter…"}
                    </DropdownMenuItem>
                    {filePath && (
                      <DropdownMenuItem onClick={() => void handleFileSave(true)}>
                        Speichern unter…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={() => {
                    setResult(null);
                    setError(null);
                    updateQuerySql(tabId, "");
                  }}
                  disabled={isRunning}
                >
                  <Trash2Icon className="size-3" />
                  Leeren
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  data-tour="query-history"
                  onClick={() => setHistoryOpen((open) => !open)}
                  title="Verlauf und gespeicherte Queries"
                >
                  <HistoryIcon className="size-3" />
                  Verlauf
                </Button>
              </>
            )}
            {workspace.analysisTools && caps.explain && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={() => void handleExplain(false)}
                  disabled={isRunning || planLoading || !sql.trim()}
                  title="Ausführungsplan anzeigen (führt nichts aus)"
                >
                  <GaugeIcon className="size-3" />
                  Explain
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={() => void handleExplain(true)}
                  disabled={isRunning || planLoading || !sql.trim()}
                  title="Achtung: führt die Query wirklich aus und misst sie"
                >
                  {planLoading ? (
                    <LoaderIcon className="size-3 animate-spin" />
                  ) : (
                    <GaugeIcon className="size-3" />
                  )}
                  Explain Analyze
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={() => setPerfOpen((open) => !open)}
                  disabled={isRunning || !sql.trim()}
                  title="Laufzeit der aktuellen Abfrage mehrfach messen und Läufe vergleichen"
                >
                  <TimerIcon className="size-3" />
                  Performance-Test
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 text-xs">
                  Bearbeiten
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {[
                  ["actions.find", "Suchen"],
                  ["editor.action.startFindReplaceAction", "Suchen und ersetzen"],
                  ["editor.action.quickCommand", "Editor-Befehlspalette"],
                  ["editor.action.gotoLine", "Gehe zu Zeile"],
                  ["editor.action.commentLine", "Zeilenkommentar umschalten"],
                  ["editor.action.blockComment", "Blockkommentar umschalten"],
                  ["editor.action.foldAll", "Alles einklappen"],
                  ["editor.action.unfoldAll", "Alles aufklappen"],
                  ["editor.action.selectHighlights", "Alle Vorkommen auswählen"],
                ].map(([id, label]) => (
                  <DropdownMenuItem key={id} onClick={() => editorApiRef.current?.action(id)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {externalChange && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
            <AlertTriangleIcon className="size-3.5 text-amber-500" />
            <span className="min-w-0 flex-1 truncate">
              Datei wurde außerhalb von l8db geändert
              {fileDirty ? " – lokale Änderungen vorhanden" : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              disabled={fileBusy}
              onClick={() => void reloadFromFile()}
            >
              {fileDirty ? "Neu laden (lokale Änderungen verwerfen)" : "Neu laden"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={fileBusy}
              onClick={() => void keepLocal()}
            >
              Lokale Fassung behalten
            </Button>
          </div>
        )}

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          onLayoutChanged={(layout) => {
            if (layout.navigator && Math.abs(layout.navigator - workspace.navigatorShare) > 0.1)
              workspace.update({ navigatorShare: layout.navigator });
          }}
        >
          {workspace.navigatorVisible && caps.query_language === "sql" && connection && (
            <>
              <ResizablePanel
                id="navigator"
                defaultSize={`${workspace.navigatorShare}%`}
                minSize="180px"
                maxSize="40%"
              >
                <QuerySchemaBrowser
                  tables={registry.tables}
                  columns={registry.columns}
                  kind={connection.kind}
                  sql={sql}
                  loading={tablesLoading || columnsLoading}
                  error={tablesError || columnsError}
                  onRefresh={() => {
                    void refreshTables();
                    void refreshColumns();
                  }}
                  onInsert={(text) => editorApiRef.current?.insertText(text)}
                  onJump={(line, column) => editorApiRef.current?.revealMatch(line, column)}
                  onClose={() => workspace.update({ navigatorVisible: false })}
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          <ResizablePanel id="query-workspace" minSize="50%" className="min-w-0">
            <ResizablePanelGroup
              groupRef={workspaceGroup}
              orientation={workspace.layout}
              className="min-h-0 flex-1"
              onLayoutChanged={(layout) => {
                if (
                  !editorFocus &&
                  layout.editor &&
                  layout.results &&
                  Math.abs(layout.editor - workspace.editorShare) > 0.1
                )
                  workspace.update({ editorShare: layout.editor });
              }}
            >
              <ResizablePanel
                id="editor"
                defaultSize={`${workspace.editorShare}%`}
                minSize="20%"
                className="flex min-h-0 flex-col"
              >
                <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/10 px-4 text-[11px] text-muted-foreground">
                  <FileIcon className="size-3" />
                  <span className="truncate">
                    {filePath?.split(/[\\/]/).pop() ?? "Abfrage.sql"}
                  </span>
                  {fileDirty && <span className="size-1.5 rounded-full bg-amber-500" />}
                  <span className="ml-auto">{scriptSplit.statements.length} Statements</span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <QueryEditorPane
                    language={caps.query_language === "json" ? "json" : "sql"}
                    ref={editorApiRef}
                    value={sql}
                    onChange={(v) => {
                      setStatementRange(null);
                      setStatementError(null);
                      updateQuerySql(tabId, v);
                    }}
                    onRun={handleRun}
                    onSave={() => void handleFileSave(false)}
                    onRunSelection={handleRunSelection}
                    onRunStatement={handleRunStatement}
                    onSelectionChange={setSelectedSql}
                    onCursorChange={setCursorOffset}
                    onPositionChange={setCursorPosition}
                    highlight={statementRange}
                    bookmarks={normalizedBookmarks}
                    onBookmarksChange={(lines) => setQueryBookmarks(tabId, lines)}
                    onSearchTabs={() => setTabSearchOpen(true)}
                    registry={registry}
                  />
                </div>

                {workspace.statusVisible && (
                  <QueryEditorStatusbar
                    position={cursorPosition}
                    selectionLength={selectedSql.length}
                    statementCount={scriptSplit.statements.length}
                    dialectLabel={dialectLabel}
                  />
                )}
              </ResizablePanel>
              {!editorFocus && <ResizableHandle withHandle />}
              {!editorFocus && (
                <ResizablePanel
                  id="results"
                  minSize="20%"
                  defaultSize={`${100 - workspace.editorShare}%`}
                  className="flex min-h-0 flex-col overflow-hidden"
                >
                  <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-1 text-xs">
                    <span className="font-medium">Ergebnisse</span>
                    <span role="status" className="text-muted-foreground">
                      {isRunning
                        ? "Wird ausgeführt…"
                        : error
                          ? "Fehlgeschlagen"
                          : result
                            ? "Abgeschlossen"
                            : "Bereit"}
                    </span>{" "}
                    {statusText && (
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {statusText}
                      </span>
                    )}
                    {result && result.columns.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1.5 px-3 text-xs"
                            disabled={exporting}
                          >
                            {exporting ? (
                              <LoaderIcon className="size-3 animate-spin" />
                            ) : (
                              <DownloadIcon className="size-3" />
                            )}
                            Export
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setCsvExportOpen(true)}>
                            Als CSV exportieren…
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setXlsxExportOpen(true)}>
                            Als XLSX exportieren…
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handleExportJson()}>
                            Als JSON exportieren
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {error && !statusText && (
                      <span className="ml-auto text-xs text-destructive">Fehler</span>
                    )}
                  </div>

                  {statementError && (
                    <p className="shrink-0 border-b px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                      {statementError}
                    </p>
                  )}
                  {perfOpen && caps.explain && (
                    <QueryPerfPanel
                      sql={selectedSql.trim() ? selectedSql : sql}
                      onClose={() => setPerfOpen(false)}
                    />
                  )}

                  {planError && (
                    <p className="shrink-0 border-b px-3 py-1.5 text-xs text-destructive">
                      {planError}
                    </p>
                  )}
                  {plan && (
                    <ExplainPlanView
                      plan={plan.node}
                      analyzed={plan.analyzed}
                      sql={plan.sql}
                      connectionName={connection?.name ?? ""}
                      databaseKind={connection?.kind ?? ""}
                      database={database}
                      onClose={() => setPlan(null)}
                    />
                  )}

                  {connection && caps.server_output && outputOpen && (
                    <ServerOutputPanel
                      connectionId={connection.id}
                      connectionName={connection.name}
                      enabled={outputEnabled}
                      busy={outputBusy}
                      onToggle={(next) => void handleToggleServerOutput(next)}
                      onClose={() => setOutputOpen(false)}
                    />
                  )}

                  {scriptEntries && scriptEntries.length > 0 && (
                    <ScriptResultList
                      entries={scriptEntries}
                      activeIndex={scriptActiveIndex}
                      onSelect={handleSelectScriptEntry}
                      onClose={() => setScriptEntries(null)}
                      note={scriptNote}
                    />
                  )}

                  <div className="min-h-0 flex-1 border-t">
                    <QueryResultWorkbench result={result} isLoading={isRunning} error={error} />
                  </div>
                </ResizablePanel>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>

        <SaveQueryDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          onSave={(name) => saveQuery(name, sql)}
        />

        <SnippetManagerDialog
          open={snippetDialogOpen}
          onOpenChange={setSnippetDialogOpen}
          initialBody={selectedSql}
          onInsert={(snippet) => {
            setSnippetDialogOpen(false);
            editorApiRef.current?.insertSnippet(snippet.body);
          }}
        />

        <BindParamsDialog
          open={bindDialogOpen}
          onOpenChange={(open) => {
            setBindDialogOpen(open);
            if (!open) setBindPendingSql(null);
          }}
          refs={bindRefs}
          values={bindValues}
          onValuesChange={setBindValues}
          onConfirm={handleBindConfirm}
        />

        <ScriptRunDialog
          open={scriptDialogOpen}
          onOpenChange={setScriptDialogOpen}
          statementCount={scriptSplit.statements.length}
          mode={scriptMode}
          unterminated={scriptSplit.unterminated}
          onConfirm={() => {
            setScriptDialogOpen(false);
            void runScript(scriptMode);
          }}
        />

        <TabSearchDialog
          open={tabSearchOpen}
          onOpenChange={setTabSearchOpen}
          initialQuery={selectedSql}
          currentTabId={tabId}
        />

        <CsvExportDialog
          open={csvExportOpen}
          onOpenChange={setCsvExportOpen}
          columns={result?.columns ?? []}
          rows={exportRows}
          defaultFileName="query-result.csv"
        />

        <XlsxExportDialog
          open={xlsxExportOpen}
          onOpenChange={setXlsxExportOpen}
          columns={result?.columns ?? []}
          rows={exportRows}
          defaultFileName="query-result.xlsx"
        />
      </motion.div>
      {historyOpen && (
        <QueryHistoryPanel
          connectionId={connection?.id ?? null}
          onLoad={(loaded) => updateQuerySql(tabId, loaded)}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

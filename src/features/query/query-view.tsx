import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangleIcon,
  BookmarkIcon,
  DownloadIcon,
  FileIcon,
  GaugeIcon,
  BookmarkPlusIcon,
  HistoryIcon,
  ListOrderedIcon,
  LoaderIcon,
  PlayIcon,
  ScanTextIcon,
  SearchIcon,
  TextSelectIcon,
  Trash2Icon,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { ExplainPlanView } from "@/features/query/explain-plan-view";
import { QueryEditorPane, type QueryEditorApi } from "@/features/query/query-editor-pane";
import { QueryHistoryPanel } from "@/features/query/query-history-panel";
import { QueryResultTable } from "@/features/query/query-result-table";
import { SaveQueryDialog } from "@/features/query/save-query-dialog";
import { SnippetManagerDialog } from "@/features/query/snippet-manager-dialog";
import { SnippetMenu } from "@/features/query/snippet-menu";
import {
  ScriptResultList,
  type ScriptRunEntry,
} from "@/features/query/script-result-list";
import { ScriptRunDialog, type ScriptRunMode } from "@/features/query/script-run-dialog";
import { TabSearchDialog } from "@/features/query/tab-search-dialog";
import { useActiveConnection } from "@/lib/connections";
import {
  beginTransaction,
  type ExplainNode,
  executeInTransaction,
  executeQuery,
  explainQuery,
  listAllColumns,
  listTables,
  type QueryResult,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { openSqlFileAsTab, useQueryFile } from "@/lib/hooks/use-query-file";
import { useCapabilities } from "@/lib/providers";
import { useSchemasQuery } from "@/lib/queries";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh";
import { useQueryRevealStore } from "@/lib/query-reveal";
import { splitSqlStatements, statementAtOffset } from "@/lib/sql-statements";
import { isQueryTabDirty, normalizeBookmarks, useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection, useTransactionStore } from "@/lib/transactions";

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
  const [exporting, setExporting] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [plan, setPlan] = useState<{ node: ExplainNode; analyzed: boolean } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const [selectedSql, setSelectedSql] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const [statementRange, setStatementRange] = useState<{ start: number; end: number } | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);

  const [editorHeight, setEditorHeight] = useState(280);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

  const bookmarks = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? (tab.bookmarks ?? EMPTY_BOOKMARKS) : EMPTY_BOOKMARKS;
  });
  const setQueryBookmarks = useTableTabs((state) => state.setQueryBookmarks);
  const clearQueryBookmarks = useTableTabs((state) => state.clearQueryBookmarks);
  const normalizedBookmarks = useMemo(() => normalizeBookmarks(bookmarks), [bookmarks]);

  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [scriptMode, setScriptMode] = useState<ScriptRunMode>("autocommit");
  const [scriptEntries, setScriptEntries] = useState<ScriptRunEntry[] | null>(null);
  const [scriptActiveIndex, setScriptActiveIndex] = useState<number | null>(null);
  const [scriptNote, setScriptNote] = useState("");

  const revealRequest = useQueryRevealStore((state) => state.request);
  const clearReveal = useQueryRevealStore((state) => state.clearReveal);

  useEffect(() => {
    setSelectedSql("");
    setCursorOffset(0);
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

  const { data: tables } = useQuery({
    queryKey: ["all-tables", connection?.id, database],
    queryFn: () =>
      listTables(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: Boolean(connection),
  });

  const { data: columns } = useQuery({
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

  const registry = {
    schemas: schemas ?? [],
    tables: tables ?? [],
    columns: columns ?? [],
  };

  const caps = useCapabilities(connection?.kind);

  const runSql = useCallback(
    async (text: string) => {
      const sql = text;
      if (!connection || !sql.trim()) return;
    setIsRunning(true);
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
        const res = await executeInTransaction(existingTx.txId, sql);
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
        const res = await executeInTransaction(txId, sql);
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
        const res = await executeQuery(
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
      setIsRunning(false);
    }
    },
    [connection, database, recordHistory, caps.transactions],
  );

  const handleRun = useCallback(() => {
    setStatementRange(null);
    setStatementError(null);
    void runSql(sql);
  }, [runSql, sql]);

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
    const statement = statementAtOffset(sql, cursorOffset);
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
  }, [cursorOffset, handleRunSelection, runSql, selectedSql, sql]);

  const scriptSplit = useMemo(() => splitSqlStatements(sql), [sql]);

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
      if (!connection || isRunning) return;
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
          if (res.columns.length > 0 || lastResult === null) lastResult = res;
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
      setIsRunning(false);
    },
    [connection, database, isRunning, recordHistory, scriptSplit],
  );

  const handleSelectScriptEntry = useCallback(
    (entry: ScriptRunEntry) => {
      setScriptActiveIndex(entry.index);
      setStatementRange({ start: entry.start, end: entry.end });
      const before = sql.slice(0, entry.start).split("\n");
      editorApiRef.current?.revealMatch(before.length, before[before.length - 1].length + 1, 0);
    },
    [sql],
  );

  const handleExplain = useCallback(
    async (analyze: boolean) => {
      if (!connection || !sql.trim() || planLoading) return;
      setPlanLoading(true);
      setPlanError(null);
      try {
        const plans = await explainQuery(
          connection.kind,
          effectiveConnectionString(connection),
          sql,
          analyze,
          database ?? undefined,
        );
        const node = plans[0]?.Plan;
        if (!node) {
          setPlanError("Kein Ausführungsplan erhalten.");
          setPlan(null);
        } else {
          setPlan({ node, analyzed: analyze });
        }
      } catch (err) {
        setPlanError(String(err));
        setPlan(null);
      } finally {
        setPlanLoading(false);
      }
    },
    [connection, sql, database, planLoading],
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
    } catch {
    } finally {
      setExporting(false);
    }
  };

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, h: editorHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (!dragStartRef.current) return;
      const delta = ev.clientY - dragStartRef.current.y;
      setEditorHeight(Math.max(80, Math.min(700, dragStartRef.current.h + delta)));
    };

    const onUp = () => {
      dragStartRef.current = null;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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
        <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-card/60 px-3" data-tour="query-toolbar">
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1.5 px-3 text-xs"
            data-tour="query-run"
            onClick={handleRun}
            disabled={isRunning || !connection}
          >
            <PlayIcon className="size-3" />
            Ausführen
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-3 text-xs"
            data-tour="query-run-selection"
            onClick={handleRunSelection}
            disabled={isRunning || !connection || !selectedSql.trim()}
            title="Nur den markierten Text ausführen (Cmd/Ctrl+Shift+Enter)"
          >
            <TextSelectIcon className="size-3" />
            Auswahl
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-3 text-xs"
            data-tour="query-run-statement"
            onClick={handleRunStatement}
            disabled={isRunning || !connection || !sql.trim()}
            title="Statement unter dem Cursor ausführen (Cmd/Ctrl+Alt+Enter)"
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
                Lesezeichen setzen/entfernen (Cmd/Ctrl+Alt+B)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => editorApiRef.current?.gotoBookmark("next")}
                disabled={normalizedBookmarks.length === 0}
              >
                Nächstes Lesezeichen (F2)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => editorApiRef.current?.gotoBookmark("previous")}
                disabled={normalizedBookmarks.length === 0}
              >
                Vorheriges Lesezeichen (Shift+F2)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => clearQueryBookmarks(tabId)}
                disabled={normalizedBookmarks.length === 0}
              >
                Alle Lesezeichen entfernen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              <DropdownMenuItem onClick={() => void handleFileOpen()}>SQL-Datei öffnen…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleFileSave(false)} disabled={!sql.trim() && !filePath}>
                {filePath ? "Speichern" : "Speichern unter…"}
              </DropdownMenuItem>
              {filePath && (
                <DropdownMenuItem onClick={() => void handleFileSave(true)}>Speichern unter…</DropdownMenuItem>
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
          {caps.explain && (
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
            </>
          )}
          {!connection && (
            <span className="ml-2 text-xs text-muted-foreground">Keine Verbindung aktiv</span>
          )}
          {connection && caps.query_language !== "sql" && (
            <span className="ml-2 text-xs text-muted-foreground">
              {QUERY_LANGUAGES[caps.query_language]}
            </span>
          )}
          {statusText && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{statusText}</span>
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
                <DropdownMenuItem onClick={() => void handleExportJson()}>
                  Als JSON exportieren
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {error && !statusText && <span className="ml-auto text-xs text-destructive">Fehler</span>}
        </div>

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

        <div style={{ height: editorHeight }} className="shrink-0 overflow-hidden">
          <QueryEditorPane
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
            highlight={statementRange}
            bookmarks={normalizedBookmarks}
            onBookmarksChange={(lines) => setQueryBookmarks(tabId, lines)}
            onSearchTabs={() => setTabSearchOpen(true)}
            registry={registry}
          />
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={handleDragStart}
          className="h-1 shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-border"
        />

        {statementError && (
          <p className="shrink-0 border-b px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            {statementError}
          </p>
        )}
        {planError && (
          <p className="shrink-0 border-b px-3 py-1.5 text-xs text-destructive">{planError}</p>
        )}
        {plan && (
          <ExplainPlanView
            plan={plan.node}
            analyzed={plan.analyzed}
            onClose={() => setPlan(null)}
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
          <QueryResultTable result={result} isLoading={isRunning} error={error} />
        </div>

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

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
  HistoryIcon,
  LoaderIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExplainPlanView } from "@/features/query/explain-plan-view";
import { QueryEditorPane } from "@/features/query/query-editor-pane";
import { QueryHistoryPanel } from "@/features/query/query-history-panel";
import { QueryResultTable } from "@/features/query/query-result-table";
import { SaveQueryDialog } from "@/features/query/save-query-dialog";
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
import { isQueryTabDirty, useTableTabs } from "@/lib/table-tabs";
import { getTransactionForConnection, useTransactionStore } from "@/lib/transactions";

const QUERY_LANGUAGES = {
  sql: "SQL",
  cql: "CQL",
  json: "MongoDB-Befehle als JSON",
  redis: "Redis-Befehle, eine pro Zeile",
} as const;

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
  const [historyOpen, setHistoryOpen] = useState(false);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [plan, setPlan] = useState<{ node: ExplainNode; analyzed: boolean } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const [editorHeight, setEditorHeight] = useState(280);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

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

  const handleRun = useCallback(async () => {
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
  }, [connection, sql, database, recordHistory, caps.transactions]);

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

  const handleExport = async (format: "csv" | "json") => {
    if (!result || result.columns.length === 0) return;
    setExporting(true);
    try {
      const ext = format === "csv" ? "csv" : "json";
      const filePath = await save({
        defaultPath: `query-result.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      });
      if (!filePath) return;

      let content: string;
      if (format === "csv") {
        const header = result.columns.map((c) => JSON.stringify(c)).join(",");
        const rows = result.rows.map((row) =>
          result.columns
            .map((c) => {
              const v = row[c];
              if (v === null || v === undefined) return "";
              return `"${v.replace(/"/g, '""')}"`;
            })
            .join(","),
        );
        content = [header, ...rows].join("\n");
      } else {
        content = JSON.stringify(result.rows, null, 2);
      }
      await writeTextFile(filePath, content);
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
            variant="ghost"
            className="h-7 gap-1.5 px-3 text-xs"
            onClick={() => setSaveDialogOpen(true)}
            disabled={!sql.trim()}
          >
            <BookmarkIcon className="size-3" />
            Speichern
          </Button>
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
                <DropdownMenuItem onClick={() => void handleExport("csv")}>
                  Als CSV exportieren
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleExport("json")}>
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
            value={sql}
            onChange={(v) => updateQuerySql(tabId, v)}
            onRun={handleRun}
            onSave={() => void handleFileSave(false)}
            registry={registry}
          />
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={handleDragStart}
          className="h-1 shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-border"
        />

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

        <div className="min-h-0 flex-1 border-t">
          <QueryResultTable result={result} isLoading={isRunning} error={error} />
        </div>

        <SaveQueryDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          onSave={(name) => saveQuery(name, sql)}
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

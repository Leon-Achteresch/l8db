import { useCallback, useEffect, useRef, useState } from "react";

import { getRouteApi } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  CheckCircleIcon,
  LoaderIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { executeQuery, validateSql } from "@/lib/db";
import { addSqlFormatAction, monaco } from "@/lib/monaco";
import { useTriggersQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";
import { useMemo } from "react";

const routeApi = getRouteApi("/_app/triggers/$schema/$table/$trigger");

function themeFor(resolved: string | undefined): string {
  return resolved === "dark" ? "l8db-dark" : "l8db-light";
}

type ValidationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; message: string };

type ExecutionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; time: number }
  | { status: "error"; message: string };

export function TriggerView() {
  const { schema, table, trigger: triggerName } = routeApi.useParams();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const openTab = useTableTabs((state) => state.openTriggerTab);
  const { data: triggers, isLoading, isError, error } = useTriggersQuery(schema, table);

  const trigger = useMemo(
    () => triggers?.find((t) => t.trigger_name === triggerName),
    [triggers, triggerName],
  );

  const [draft, setDraft] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [execution, setExecution] = useState<ExecutionState>({ status: "idle" });

  const currentValue = draft ?? trigger?.definition ?? "";
  const isDirty = draft !== null && draft !== trigger?.definition;

  useEffect(() => {
    openTab({ schema, table, trigger: triggerName });
  }, [schema, table, triggerName, openTab]);

  useEffect(() => {
    setDraft(null);
    setValidation({ status: "idle" });
    setExecution({ status: "idle" });
  }, [schema, table, triggerName, trigger?.definition]);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setValidation({ status: "idle" });
    setExecution({ status: "idle" });
  }, []);

  const handleReset = useCallback(() => {
    setDraft(null);
    setValidation({ status: "idle" });
    setExecution({ status: "idle" });
  }, []);

  const buildDropSql = useCallback(() => {
    const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
    const quotedTable = `"${table.replace(/"/g, '""')}"`;
    const quotedTrigger = `"${triggerName.replace(/"/g, '""')}"`;
    return `DROP TRIGGER IF EXISTS ${quotedTrigger} ON ${quotedSchema}.${quotedTable};`;
  }, [schema, table, triggerName]);

  const handleCompile = useCallback(async () => {
    if (!connection) return;
    setValidation({ status: "loading" });
    setExecution({ status: "idle" });
    try {
      const sql = `${buildDropSql()}\n${currentValue}`;
      await validateSql(
        connection.kind,
        connection.connectionString,
        sql,
        database ?? undefined,
      );
      setValidation({ status: "success" });
    } catch (e) {
      setValidation({ status: "error", message: String(e) });
    }
  }, [connection, database, currentValue, buildDropSql]);

  const handleExecute = useCallback(async () => {
    if (!connection) return;
    setExecution({ status: "loading" });
    try {
      const sql = `${buildDropSql()}\n${currentValue}`;
      const result = await executeQuery(
        connection.kind,
        connection.connectionString,
        sql,
        database ?? undefined,
      );
      setExecution({ status: "success", time: result.execution_time_ms });
      setValidation({ status: "idle" });
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["triggers"] });
    } catch (e) {
      setExecution({ status: "error", message: String(e) });
    }
  }, [connection, database, currentValue, buildDropSql, queryClient]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden bg-background p-4 space-y-3 select-none">
        <Skeleton className="h-6 w-64 bg-muted/50" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5 bg-muted/30" style={{ width: `${60 + Math.random() * 30}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
          <TriangleAlertIcon className="size-8 text-destructive animate-bounce" />
          <h3 className="text-sm font-semibold text-destructive">Fehler beim Laden der Trigger</h3>
          <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  if (!trigger) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">
          Trigger &quot;{triggerName}&quot; nicht gefunden.
        </p>
      </div>
    );
  }

  const feedbackState = execution.status !== "idle" ? execution : validation;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="flex flex-1 items-center gap-2 overflow-hidden">
          <span className="text-xs font-medium text-muted-foreground truncate">
            {schema}.{table}
          </span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-sm font-semibold text-foreground truncate">{trigger.trigger_name}</span>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
              {trigger.timing}
            </Badge>
            <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
              {trigger.event}
            </Badge>
            <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
              {trigger.orientation}
            </Badge>
            <Badge
              variant={trigger.enabled === "DISABLED" ? "destructive" : "secondary"}
              className="shrink-0 text-[10px] px-1.5 py-0"
            >
              {trigger.enabled}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isDirty ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={handleReset}
              disabled={validation.status === "loading" || execution.status === "loading"}
            >
              <RotateCcwIcon data-icon="inline-start" className="size-3.5" />
              Zurücksetzen
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            onClick={handleCompile}
            disabled={!isDirty || validation.status === "loading" || execution.status === "loading"}
          >
            {validation.status === "loading" ? (
              <LoaderIcon data-icon="inline-start" className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheckIcon data-icon="inline-start" className="size-3.5" />
            )}
            Kompilieren
          </Button>
          <Button
            variant="default"
            size="xs"
            onClick={handleExecute}
            disabled={!isDirty || execution.status === "loading"}
          >
            {execution.status === "loading" ? (
              <LoaderIcon data-icon="inline-start" className="size-3.5 animate-spin" />
            ) : (
              <PlayIcon data-icon="inline-start" className="size-3.5" />
            )}
            Ausführen
          </Button>
        </div>
      </div>

      <TriggerEditorPane
        value={currentValue}
        onChange={handleChange}
      />

      {feedbackState.status !== "idle" && feedbackState.status !== "loading" && (
        <FeedbackPanel state={feedbackState} />
      )}
    </div>
  );
}

function FeedbackPanel({
  state,
}: {
  state:
    | { status: "success"; time?: number }
    | { status: "error"; message: string };
}) {
  return (
    <div
      className={
        state.status === "success"
          ? "flex items-start gap-2 border-t bg-emerald-500/5 px-4 py-2.5"
          : "flex items-start gap-2 border-t bg-destructive/5 px-4 py-2.5"
      }
    >
      {state.status === "success" ? (
        <>
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Erfolgreich
            {state.time != null ? ` (${state.time} ms)` : ""}
          </span>
        </>
      ) : (
        <>
          <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <pre className="flex-1 whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
            {state.message}
          </pre>
        </>
      )}
    </div>
  );
}

interface TriggerEditorPaneProps {
  value: string;
  onChange: (value: string) => void;
}

function TriggerEditorPane({ value, onChange }: TriggerEditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const { resolvedTheme } = useTheme();

  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      value,
      language: "sql",
      theme: themeFor(resolvedTheme),
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      glyphMargin: false,
      folding: true,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      lineHeight: 24,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      padding: { top: 16, bottom: 16 },
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        vertical: "auto",
        horizontal: "auto",
        useShadows: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      tabSize: 2,
    });

    editorRef.current = editor;

    const changeSub = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });

    const formatAction = addSqlFormatAction(editor);

    return () => {
      changeSub.dispose();
      formatAction.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    monaco.editor.setTheme(themeFor(resolvedTheme));
  }, [resolvedTheme]);

  return <div ref={containerRef} className="size-full min-h-0 flex-1" />;
}

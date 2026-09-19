import { useQueryClient } from "@tanstack/react-query";
import { Loader, Play, ShieldCheck } from "lucide";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery, validateSql } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useTriggersQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { FeedbackPanel } from "./trigger-view/feedback-panel";
import { TriggerEditorPane } from "./trigger-view/trigger-editor-pane";

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

export interface TriggerViewProps {
  schema: string;
  table: string;
  trigger: string;
}

export function TriggerView({ schema, table, trigger: triggerName }: TriggerViewProps) {
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
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    switch (connection?.kind) {
      case "postgres":
        return `DROP TRIGGER IF EXISTS ${q(triggerName)} ON ${q(schema)}.${q(table)};\n`;
      case "sqlite":
        return `DROP TRIGGER IF EXISTS ${q(schema)}.${q(triggerName)};\n`;
      case "mysql":
        return `DROP TRIGGER IF EXISTS \`${schema.replace(/`/g, "``")}\`.\`${triggerName.replace(/`/g, "``")}\`;\n`;
      default:
        return "";
    }
  }, [connection?.kind, schema, table, triggerName]);

  const handleCompile = useCallback(async () => {
    if (!connection) return;
    setValidation({ status: "loading" });
    setExecution({ status: "idle" });
    try {
      const sql = `${buildDropSql()}${currentValue}`;
      await validateSql(
        connection.kind,
        effectiveConnectionString(connection),
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
      const sql = `${buildDropSql()}${currentValue}`;
      const result = await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
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
            <Skeleton
              key={i}
              className="h-5 bg-muted/30"
              style={{ width: `${60 + Math.random() * 30}%` }}
            />
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
          <span className="text-sm font-semibold text-foreground truncate">
            {trigger.trigger_name}
          </span>
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
            <MorphIcon
              icon={validation.status === "loading" ? Loader : ShieldCheck}
              data-icon="inline-start"
              className={cn("size-3.5", validation.status === "loading" && "animate-spin")}
            />
            Kompilieren
          </Button>
          <Button
            variant="default"
            size="xs"
            onClick={handleExecute}
            disabled={!isDirty || execution.status === "loading"}
          >
            <MorphIcon
              icon={execution.status === "loading" ? Loader : Play}
              data-icon="inline-start"
              className={cn("size-3.5", execution.status === "loading" && "animate-spin")}
            />
            Ausführen
          </Button>
        </div>
      </div>

      <TriggerEditorPane
        value={currentValue}
        onChange={handleChange}
        error={feedbackState.status === "error" ? feedbackState.message : null}
        errorPrefix={buildDropSql()}
      />

      {feedbackState.status !== "idle" && feedbackState.status !== "loading" && (
        <FeedbackPanel state={feedbackState} />
      )}
    </div>
  );
}

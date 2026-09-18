import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader, Play } from "lucide";
import { PencilIcon, TriangleAlertIcon, UndoIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery, validateSql } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useExtensionsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { FeedbackPanel } from "./extension-view/feedback-panel";
import { SqlEditorPane } from "./extension-view/sql-editor-pane";

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

function buildExtensionSql(ext: {
  name: string;
  version: string | null;
  schema: string | null;
  description: string | null;
}): string {
  return [
    `-- Extension: ${ext.name}`,
    `-- Version:   ${ext.version ?? "unbekannt"}`,
    `-- Schema:    ${ext.schema ?? "unbekannt"}`,
    ext.description ? `-- ${ext.description}` : null,
    "",
    `CREATE EXTENSION IF NOT EXISTS "${ext.name}"`,
    ext.schema ? `    SCHEMA "${ext.schema}"` : null,
    ext.version ? `    VERSION '${ext.version}'` : null,
    ";",
    "",
    `-- DROP EXTENSION IF EXISTS "${ext.name}";`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export function ExtensionView({ name }: { name: string }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const openExtensionTab = useTableTabs((state) => state.openExtensionTab);
  const { data: extensions, isLoading, isError, error } = useExtensionsQuery();

  const ext = extensions?.find((e) => e.name === name);

  const [editing, setEditing] = useState(false);
  const [editedSql, setEditedSql] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ status: "idle" });
  const [execution, setExecution] = useState<ExecutionState>({ status: "idle" });

  useEffect(() => {
    openExtensionTab({ name });
  }, [name, openExtensionTab]);

  const displaySql = ext ? buildExtensionSql(ext) : "";

  const handleEdit = useCallback(() => {
    setEditing(true);
    setEditedSql(displaySql);
    setValidation({ status: "idle" });
    setExecution({ status: "idle" });
  }, [displaySql]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setEditedSql("");
    setValidation({ status: "idle" });
    setExecution({ status: "idle" });
  }, []);

  const handleValidate = useCallback(async () => {
    if (!connection) return;
    setValidation({ status: "loading" });
    setExecution({ status: "idle" });
    try {
      await validateSql(
        connection.kind,
        effectiveConnectionString(connection),
        editedSql,
        database ?? undefined,
      );
      setValidation({ status: "success" });
    } catch (e) {
      setValidation({ status: "error", message: String(e) });
    }
  }, [connection, database, editedSql]);

  const handleExecute = useCallback(async () => {
    if (!connection) return;
    setExecution({ status: "loading" });
    try {
      const result = await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        editedSql,
        database ?? undefined,
      );
      setExecution({ status: "success", time: result.execution_time_ms });
      setValidation({ status: "idle" });
      await queryClient.invalidateQueries({ queryKey: ["extensions"] });
      setEditing(false);
      setEditedSql("");
    } catch (e) {
      setExecution({ status: "error", message: String(e) });
    }
  }, [connection, database, editedSql, queryClient]);

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
              style={{ width: `${40 + Math.random() * 40}%` }}
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
          <h3 className="text-sm font-semibold text-destructive">
            Fehler beim Laden der Extension
          </h3>
          <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  if (!ext) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">
          Extension &quot;{name}&quot; nicht gefunden.
        </p>
      </div>
    );
  }

  const feedbackState = execution.status !== "idle" ? execution : validation;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground flex-1">
          {ext.name} {ext.version ? `v${ext.version}` : ""}
        </span>
        {!editing ? (
          <Button variant="outline" size="xs" onClick={handleEdit}>
            <PencilIcon data-icon="inline-start" />
            Bearbeiten
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="xs" onClick={handleCancel}>
              <UndoIcon data-icon="inline-start" />
              Abbrechen
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={handleValidate}
              disabled={validation.status === "loading" || execution.status === "loading"}
            >
              <MorphIcon
                icon={validation.status === "loading" ? Loader : CheckCircle}
                data-icon="inline-start"
                className={validation.status === "loading" ? "animate-spin" : undefined}
              />
              Prüfen
            </Button>
            <Button
              variant="default"
              size="xs"
              onClick={handleExecute}
              disabled={execution.status === "loading"}
            >
              <MorphIcon
                icon={execution.status === "loading" ? Loader : Play}
                data-icon="inline-start"
                className={execution.status === "loading" ? "animate-spin" : undefined}
              />
              Ausführen
            </Button>
          </>
        )}
      </div>

      <SqlEditorPane
        value={editing ? editedSql : displaySql}
        readOnly={!editing}
        onChange={editing ? setEditedSql : undefined}
      />

      {feedbackState.status !== "idle" && feedbackState.status !== "loading" && (
        <FeedbackPanel state={feedbackState} />
      )}
    </div>
  );
}

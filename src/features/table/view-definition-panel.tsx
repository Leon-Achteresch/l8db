import { useCallback, useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CopyIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { toast } from "sonner";

import { SqlEditor } from "@/features/table/sql-editor";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { updateViewDefinition } from "@/lib/db";
import { useViewDefinitionQuery } from "@/lib/queries";

interface ViewDefinitionPanelProps {
  schema: string;
  view: string;
}

export function ViewDefinitionPanel({
  schema,
  view,
}: ViewDefinitionPanelProps) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [compileStatus, setCompileStatus] = useState<"idle" | "ok" | "error">("idle");
  const [compileError, setCompileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: definition, isLoading } = useViewDefinitionQuery(schema, view);

  const currentValue = draft ?? definition ?? "";
  const isDirty = draft !== null && draft !== definition;

  useEffect(() => {
    setDraft(null);
    setCompileStatus("idle");
    setCompileError(null);
  }, [schema, view, definition]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(currentValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      setCompileStatus("idle");
      setCompileError(null);
    },
    [],
  );

  const handleReset = () => {
    setDraft(null);
    setCompileStatus("idle");
    setCompileError(null);
  };

  const handleCompile = async () => {
    if (!connection) return;
    setBusy(true);
    setCompileError(null);
    try {
      await updateViewDefinition(
        connection.kind,
        connection.connectionString,
        schema,
        view,
        currentValue,
        true,
        database ?? undefined,
      );
      setCompileStatus("ok");
      toast.success("View-Definition ist valide.");
    } catch (e) {
      setCompileStatus("error");
      setCompileError(String(e));
      toast.error("Kompilierungsfehler.");
    } finally {
      setBusy(false);
    }
  };

  const handleExecute = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await updateViewDefinition(
        connection.kind,
        connection.connectionString,
        schema,
        view,
        currentValue,
        false,
        database ?? undefined,
      );
      toast.success("View-Definition aktualisiert.");
      setDraft(null);
      setCompileStatus("idle");
      setCompileError(null);
      await queryClient.invalidateQueries({ queryKey: ["view-definition"] });
      await queryClient.invalidateQueries({ queryKey: ["rows"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Lade Definition…
        </div>
      </div>
    );
  }

  if (!definition) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Definition nicht verfügbar.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          aria-label="SQL kopieren"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </Button>

        {isDirty ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleReset}
            disabled={busy}
            aria-label="Zurücksetzen"
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={handleCompile}
          disabled={busy || !isDirty}
        >
          {busy ? (
            <Spinner className="size-3" />
          ) : (
            <ShieldCheckIcon className="size-3.5" />
          )}
          Kompilieren
        </Button>

        <Button
          type="button"
          variant="default"
          size="xs"
          onClick={handleExecute}
          disabled={busy || !isDirty}
        >
          <PlayIcon className="size-3.5" />
          Ausführen
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <SqlEditor
          value={currentValue}
          onChange={handleChange}
          className="min-h-0 flex-1"
        />
      </div>

      {compileError ? (
        <div className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-mono text-destructive select-text">
          {compileError}
        </div>
      ) : null}
      {compileStatus === "ok" ? (
        <div className="shrink-0 border-t border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Validierung erfolgreich.
        </div>
      ) : null}
    </div>
  );
}

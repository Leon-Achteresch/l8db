import { PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ScriptResultList } from "@/features/query/script-result-list";
import { SCRIPT_RUN_MODE_TEXT, type ScriptRunMode } from "@/features/query/script-run-dialog";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { readImportFile } from "@/lib/import-file";
import { EMPTY_SQL_IMPORT, useImportWorkspace } from "@/lib/import-workspace";
import { supports } from "@/lib/providers";
import { runSqlScript } from "@/lib/script-runner";
import { splitSqlStatements } from "@/lib/sql-statements";
import { cancelTask, isTaskActive, useTasksStore } from "@/lib/tasks";
import { getQueryTransaction, useTransactionStore } from "@/lib/transactions";

export function SqlImportPanel({
  actions,
  onPickFile,
}: {
  actions: HTMLElement | null;
  onPickFile: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const key = JSON.stringify([connection?.id, database]);
  const draft = useImportWorkspace((state) => state.sql[key] ?? EMPTY_SQL_IMPORT);
  const update = (
    patch: Parameters<ReturnType<typeof useImportWorkspace.getState>["patchSql"]>[1],
  ) => useImportWorkspace.getState().patchSql(key, patch);
  const task = useTasksStore((state) => state.tasks.find((entry) => entry.id === draft.jobId));
  const transactions = useTransactionStore((state) => state.transactions);
  const existing = connection ? getQueryTransaction(connection.id, database) : null;
  void transactions;
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const running = preparing || Boolean(task && isTaskActive(task));
  const mode: ScriptRunMode = existing
    ? "existing-transaction"
    : supports(connection, "transactions")
      ? draft.mode === "existing-transaction"
        ? "new-transaction"
        : draft.mode
      : "autocommit";
  const split = splitSqlStatements(draft.sql ?? "", connection?.kind);

  useEffect(() => {
    if (!draft.filePath || draft.sql !== null) return;
    let active = true;
    void readImportFile(draft.filePath)
      .then((file) => {
        if (active) useImportWorkspace.getState().patchSql(key, { sql: file.text });
      })
      .catch((failure) => {
        if (active) setError(`Datei erneut wählen: ${String(failure)}`);
      });
    return () => {
      active = false;
    };
  }, [draft.filePath, draft.sql, key]);

  const run = async () => {
    if (!connection || !draft.sql || running) return;
    setPreparing(true);
    setError(null);
    try {
      const outcome = await runSqlScript({
        connection,
        database,
        sql: draft.sql,
        mode,
        stopOnError: draft.stopOnError,
        title: `SQL-Import · ${draft.fileName}`,
        onJob: (jobId) => update({ jobId }),
        onProgress: (entries) => update({ entries }),
      });
      if (outcome.error) setError(outcome.error);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5">
        <span className="min-w-0 truncate font-mono text-sm">
          {draft.fileName ?? "Kein Skript gewählt"}
        </span>
        {split.statements.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {split.statements.length.toLocaleString("de-DE")} Anweisungen
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <Label htmlFor="sql-import-mode" className="text-xs font-normal text-muted-foreground">
            Ausführung
          </Label>
          <Select
            value={mode}
            disabled={running || Boolean(existing)}
            onValueChange={(value) => update({ mode: value as ScriptRunMode })}
          >
            <SelectTrigger
              id="sql-import-mode"
              size="sm"
              className="w-64 text-xs"
              title={SCRIPT_RUN_MODE_TEXT[mode]}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {existing && (
                <SelectItem value="existing-transaction">Offene Transaktion verwenden</SelectItem>
              )}
              {supports(connection, "transactions") && (
                <SelectItem value="new-transaction">Transaktion · anschließend prüfen</SelectItem>
              )}
              <SelectItem value="autocommit">Autocommit je Statement</SelectItem>
            </SelectContent>
          </Select>
          <Switch
            id="sql-import-stop"
            size="sm"
            checked={mode !== "autocommit" || draft.stopOnError}
            disabled={running || mode !== "autocommit"}
            onCheckedChange={(stopOnError) => update({ stopOnError })}
          />
          <Label htmlFor="sql-import-stop" className="text-xs font-normal">
            Bei Fehler stoppen
          </Label>
        </div>
      </div>
      {split.unterminated && (
        <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
          Offenes Literal oder Kommentar. Datei korrigieren und erneut auswählen.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="border-b px-4 py-2 text-xs whitespace-pre-wrap break-all text-destructive"
        >
          {error}
        </p>
      )}
      {draft.sql ? (
        <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap">
          {draft.sql}
        </pre>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Button variant="outline" size="sm" disabled={running} onClick={onPickFile}>
            SQL-Skript wählen…
          </Button>
        </div>
      )}
      {draft.entries && (
        <div className="max-h-[45%] min-h-0 shrink-0 overflow-hidden border-t">
          <ScriptResultList
            entries={draft.entries}
            activeIndex={activeIndex}
            onSelect={(entry) => setActiveIndex(entry.index)}
            onClose={() => update({ entries: null })}
            note={SCRIPT_RUN_MODE_TEXT[mode]}
          />
        </div>
      )}
      {actions &&
        createPortal(
          <>
            {draft.sql && (
              <Button variant="ghost" size="sm" disabled={running} onClick={onPickFile}>
                Andere Datei…
              </Button>
            )}
            {task?.cancellable && (
              <Button
                variant="outline"
                size="sm"
                disabled={task.status === "cancelling"}
                onClick={() =>
                  void cancelTask(task.id).catch((failure) => setError(String(failure)))
                }
              >
                Abbrechen
              </Button>
            )}
            <Button
              size="sm"
              disabled={running || !split.statements.length || split.unterminated}
              onClick={() => void run()}
            >
              {running ? <Spinner className="size-3.5" /> : <PlayIcon />}
              {running ? "Import läuft…" : "Ausführen"}
            </Button>
          </>,
          actions,
        )}
    </div>
  );
}

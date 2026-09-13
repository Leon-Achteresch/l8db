import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScriptResultList } from "@/features/query/script-result-list";
import { SCRIPT_RUN_MODE_TEXT, type ScriptRunMode } from "@/features/query/script-run-dialog";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { pickImportFile, readImportFile } from "@/lib/import-file";
import { EMPTY_SQL_IMPORT, useImportWorkspace } from "@/lib/import-workspace";
import { supports } from "@/lib/providers";
import { runSqlScript } from "@/lib/script-runner";
import { splitSqlStatements } from "@/lib/sql-statements";
import { cancelTask, isTaskActive, useTasksStore } from "@/lib/tasks";
import { getQueryTransaction, useTransactionStore } from "@/lib/transactions";

export function SqlImportPanel() {
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

  const pick = async () => {
    setError(null);
    try {
      const file = await pickImportFile("sql");
      if (file)
        update({
          fileName: file.name,
          filePath: file.path,
          sql: file.text,
          entries: null,
          jobId: null,
        });
    } catch (failure) {
      setError(String(failure));
    }
  };
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={running} onClick={() => void pick()}>
          Datei wählen…
        </Button>
        <span className="truncate font-mono text-xs">{draft.fileName}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Ziel: {connection?.name} · {database ?? "Standard-Datenbank"}
      </p>
      {draft.sql && (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="mb-2 text-xs">{split.statements.length} Statements · Vorschau</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {draft.sql}
          </pre>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="sql-import-mode">Ausführung</Label>
        <Select
          value={mode}
          disabled={running || Boolean(existing)}
          onValueChange={(value) => update({ mode: value as ScriptRunMode })}
        >
          <SelectTrigger id="sql-import-mode" className="w-72">
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
          checked={mode !== "autocommit" || draft.stopOnError}
          disabled={running || mode !== "autocommit"}
          onCheckedChange={(stopOnError) => update({ stopOnError })}
        />
        <Label htmlFor="sql-import-stop">Bei Fehler stoppen</Label>
      </div>
      <p className="text-xs text-muted-foreground">{SCRIPT_RUN_MODE_TEXT[mode]}</p>
      {split.unterminated && (
        <p role="alert" className="text-xs text-destructive">
          Offenes Literal oder Kommentar. Datei korrigieren und erneut auswählen.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={running || !split.statements.length || split.unterminated}
          onClick={() => void run()}
        >
          {running ? "Import läuft…" : "Ausführen"}
        </Button>
        {task?.cancellable && (
          <Button
            variant="outline"
            size="sm"
            disabled={task.status === "cancelling"}
            onClick={() => void cancelTask(task.id).catch((failure) => setError(String(failure)))}
          >
            Abbrechen
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-all text-xs text-destructive">
          {error}
        </p>
      )}
      {draft.entries && (
        <ScriptResultList
          entries={draft.entries}
          activeIndex={activeIndex}
          onSelect={(entry) => setActiveIndex(entry.index)}
          onClose={() => update({ entries: null })}
          note={SCRIPT_RUN_MODE_TEXT[mode]}
        />
      )}
    </div>
  );
}

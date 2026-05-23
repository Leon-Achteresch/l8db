import { useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { CheckCircle2Icon, FileUpIcon, XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveConnection } from "@/lib/connections";
import { executeScript, ScriptStatementResult } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";

export function ImportView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [fileName, setFileName] = useState<string | null>(null);
  const [sql, setSql] = useState<string | null>(null);
  const [results, setResults] = useState<ScriptStatementResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickFile = async () => {
    const path = await open({
      filters: [{ name: "SQL", extensions: ["sql", "txt"] }],
      multiple: false,
    });
    if (!path || typeof path !== "string") return;
    const content = await readTextFile(path);
    setFileName(path.split("/").pop() ?? path);
    setSql(content);
    setResults(null);
    setError(null);
  };

  const handleRun = async () => {
    if (!connection || !sql) return;
    setRunning(true);
    setResults(null);
    setError(null);
    try {
      const res = await executeScript(
        connection.kind,
        connection.connectionString,
        sql,
        database ?? undefined,
      );
      setResults(res);
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  const successCount = results?.filter((r) => r.success).length ?? 0;
  const errorCount = results?.filter((r) => !r.success).length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <FileUpIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">SQL importieren</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => void handlePickFile()}>
            Datei wählen…
          </Button>
          {fileName && (
            <span className="truncate font-mono text-xs text-muted-foreground">{fileName}</span>
          )}
        </div>

        {sql && (
          <div className="rounded-md border bg-muted/30 p-3">
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-foreground">
              {sql}
            </pre>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={!sql || running}
            onClick={() => void handleRun()}
          >
            {running ? "Wird ausgeführt…" : "Ausführen"}
          </Button>
          {results && (
            <div className="flex gap-2">
              <Badge
                variant="outline"
                className="text-emerald-600 border-emerald-500/20 bg-emerald-500/5"
              >
                {successCount} erfolgreich
              </Badge>
              {errorCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-destructive border-destructive/20 bg-destructive/5"
                >
                  {errorCount} Fehler
                </Badge>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </p>
        )}

        {results && results.length > 0 && (
          <ScrollArea className="min-h-0 flex-1 rounded-md border">
            <div className="divide-y">
              {results.map((r, i) => (
                <div key={i} className="flex gap-3 px-3 py-2">
                  {r.success ? (
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">
                      {r.statement}
                    </pre>
                    {r.rows_affected !== null && r.success && (
                      <span className="text-[10px] text-muted-foreground">
                        {r.rows_affected} Zeile(n) betroffen
                      </span>
                    )}
                    {r.error && (
                      <p className="mt-1 font-mono text-xs text-destructive">{r.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

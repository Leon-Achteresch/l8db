import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { type QueryResult, s3SelectObject } from "@/lib/db";
import { selectFormat } from "@/lib/storage/s3";
import { SimpleResultTable } from "./simple-result-table";
import { errorText, useStorageConnection } from "./use-storage-connection";

export function ObjectSelectPanel({ bucket, objectKey }: { bucket: string; objectKey: string }) {
  const { url } = useStorageConnection();
  const [expression, setExpression] = useState("SELECT * FROM S3Object s LIMIT 100");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const format = selectFormat(objectKey);

  if (!format) {
    return (
      <p className="text-sm text-muted-foreground">
        S3 Select unterstützt CSV, JSON und Parquet (optional gzip/bzip2).
      </p>
    );
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await s3SelectObject(url, bucket, objectKey, expression));
    } catch (err) {
      setResult(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Serverseitige Abfrage direkt auf dem Objekt ({format}). Die Datei wird nicht komplett
        übertragen.
      </p>
      <Textarea
        aria-label="S3-Select-Ausdruck"
        className="min-h-20 font-mono text-xs"
        value={expression}
        onChange={(event) => setExpression(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void run();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void run()} disabled={busy || !expression.trim()}>
          {busy ? <Spinner className="size-4" /> : null}
          Ausführen
        </Button>
        {result && (
          <span className="text-xs text-muted-foreground">
            {result.rows.length} Zeilen · {result.execution_time_ms} ms
          </span>
        )}
      </div>
      {error && <p className="text-xs break-words whitespace-pre-wrap text-destructive">{error}</p>}
      {result && (
        <SimpleResultTable
          columns={result.columns}
          rows={result.rows.map((row) => result.columns.map((column) => row[column]))}
        />
      )}
    </div>
  );
}

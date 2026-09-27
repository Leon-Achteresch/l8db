import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/backup";
import { s3PreviewObject } from "@/lib/db";
import { parseCsv, previewKind } from "@/lib/storage/s3";
import { SimpleResultTable } from "./simple-result-table";
import { errorText, useStorageConnection } from "./use-storage-connection";

const TEXT_LIMIT = 256 * 1024;
const IMAGE_LIMIT = 12 * 1024 * 1024;

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    const lines = text.split("\n").filter((line) => line.trim());
    try {
      return lines.map((line) => JSON.stringify(JSON.parse(line))).join("\n");
    } catch {
      return text;
    }
  }
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < Math.min(bytes.length, 2048); offset += 16) {
    const chunk = Array.from(bytes.slice(offset, offset + 16));
    const hex = chunk.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

export function ObjectPreview({
  bucket,
  objectKey,
  versionId,
}: {
  bucket: string;
  objectKey: string;
  versionId: string | null;
}) {
  const { connection, url } = useStorageConnection();
  const [limit, setLimit] = useState<number | null>(null);
  const guess = previewKind(objectKey, null);
  const maxBytes = limit ?? (guess === "image" ? IMAGE_LIMIT : TEXT_LIMIT);
  const preview = useQuery({
    queryKey: ["s3", connection?.id, "preview", bucket, objectKey, versionId, maxBytes],
    queryFn: () => s3PreviewObject(url, bucket, objectKey, maxBytes, versionId),
  });

  if (preview.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Lade Vorschau…
      </div>
    );
  }
  if (preview.isError)
    return <p className="text-sm break-words text-destructive">{errorText(preview.error)}</p>;
  const data = preview.data!;
  const kind = previewKind(objectKey, data.content_type);
  const bytes = decodeBase64(data.data);
  const info = (
    <p className="mb-2 text-[11px] text-muted-foreground">
      {data.content_type ?? "unbekannter Typ"} · {formatBytes(data.size)}
      {data.truncated ? ` · erste ${formatBytes(bytes.length)} angezeigt` : ""}
    </p>
  );
  const more = data.truncated && kind !== "image" && kind !== "pdf" && (
    <Button
      size="xs"
      variant="outline"
      className="mt-2"
      onClick={() => setLimit(Math.min(maxBytes * 8, 16 * 1024 * 1024))}
    >
      Mehr laden
    </Button>
  );

  if (kind === "image") {
    if (data.truncated)
      return (
        <div>
          {info}
          <p className="text-sm text-muted-foreground">Bild ist zu groß für die Vorschau.</p>
        </div>
      );
    const src = `data:${data.content_type?.startsWith("image/") ? data.content_type : "image/png"};base64,${data.data}`;
    return (
      <div>
        {info}
        <img
          src={src}
          alt={objectKey}
          className="max-h-[60vh] max-w-full rounded border object-contain"
        />
      </div>
    );
  }
  if (kind === "pdf" || kind === "binary") {
    return (
      <div>
        {info}
        <pre className="overflow-auto rounded bg-muted p-2 font-mono text-[10px] leading-4">
          {hexDump(bytes)}
        </pre>
        {kind === "pdf" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            PDF über „Im Browser öffnen“ im Kontextmenü anzeigen.
          </p>
        ) : null}
      </div>
    );
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (kind === "csv") {
    const rows = parseCsv(text, objectKey.toLowerCase().endsWith(".tsv") ? "\t" : ",");
    const [header = [], ...body] = data.truncated ? rows.slice(0, -1) : rows;
    return (
      <div>
        {info}
        <SimpleResultTable columns={header} rows={body} />
        {more}
      </div>
    );
  }
  return (
    <div>
      {info}
      <pre className="overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
        {kind === "json" && !data.truncated ? prettyJson(text) : text}
      </pre>
      {more}
    </div>
  );
}

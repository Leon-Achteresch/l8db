import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/backup";
import { s3PreviewObject } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  IMAGE_PREVIEW_LIMIT,
  initialPreviewLimit,
  nextPreviewLimit,
  objectPreviewContent,
} from "./object-preview-content";
import { ObjectReadError } from "./object-read-error";
import { SimpleResultTable } from "./simple-result-table";
import { useStorageConnection } from "./use-storage-connection";

export function ObjectPreview({
  bucket,
  objectKey,
  versionId,
  listedSize,
}: {
  bucket: string;
  objectKey: string;
  versionId: string | null;
  listedSize: number | null;
}) {
  const { connection, url } = useStorageConnection();
  const [limit, setLimit] = useState<number | null>(null);
  const maxBytes = limit ?? initialPreviewLimit(objectKey, listedSize);
  const preview = useQuery({
    queryKey: ["s3", connection?.id, "preview", bucket, objectKey, versionId, maxBytes],
    queryFn: () => s3PreviewObject(url, bucket, objectKey, maxBytes, versionId),
    retry: false,
  });
  const data = preview.data;
  const content = useMemo(() => data && objectPreviewContent(objectKey, data), [objectKey, data]);
  const imageFeature = useNewFeatureVisibility<HTMLButtonElement>("storage.objects.image-preview");

  if (preview.isError)
    return (
      <ObjectReadError
        error={preview.error}
        busy={preview.isFetching}
        onRetry={() => void preview.refetch()}
      />
    );
  if (!data || !content)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Lade Vorschau…
      </div>
    );

  const next = nextPreviewLimit(content.kind, data, maxBytes);
  const hex = content.kind === "binary" || content.kind === "pdf";
  return (
    <div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {data.content_type ?? "unbekannter Typ"} ·{" "}
        {data.size === null ? "Größe unbekannt" : formatBytes(data.size)}
        {hex &&
          (data.truncated || (data.size !== null && data.size > content.bytes)) &&
          ` · erste ${formatBytes(content.bytes)} als Hex angezeigt`}
        {!hex &&
          content.kind !== "image" &&
          data.truncated &&
          ` · erste ${formatBytes(content.bytes)} geladen`}
        {!hex &&
          content.kind !== "image" &&
          data.truncated &&
          !next &&
          " · Vorschaugrenze erreicht"}
      </p>
      {content.kind === "image" ? (
        !data.truncated ? (
          <img
            src={`data:${data.content_type?.toLowerCase().startsWith("image/") ? data.content_type : "image/png"};base64,${data.data}`}
            alt={objectKey}
            className="max-h-[60vh] max-w-full rounded border object-contain"
          />
        ) : (
          !next && (
            <p className="text-sm text-muted-foreground">
              {data.size !== null && data.size > IMAGE_PREVIEW_LIMIT
                ? `Bild ist zu groß für die Vorschau (maximal ${formatBytes(IMAGE_PREVIEW_LIMIT)}).`
                : "Bild wurde unvollständig geladen."}
            </p>
          )
        )
      ) : content.kind === "csv" ? (
        <SimpleResultTable columns={content.columns} rows={content.rows} />
      ) : (
        <pre
          className={
            hex
              ? "overflow-auto rounded bg-muted p-2 font-mono text-[10px] leading-4"
              : "overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all"
          }
        >
          {content.text}
        </pre>
      )}
      {content.kind === "pdf" && (
        <p className="mt-2 text-xs text-muted-foreground">
          PDF über „Im Browser öffnen“ im Kontextmenü anzeigen.
        </p>
      )}
      {next !== null && (
        <Button
          ref={content.kind === "image" ? imageFeature.ref : undefined}
          size="xs"
          variant="outline"
          className="mt-2"
          onClick={() => setLimit(next)}
        >
          {content.kind === "image" ? "Bildvorschau laden" : "Mehr laden"}
          {content.kind === "image" && imageFeature.isNew && <NewBadge />}
        </Button>
      )}
    </div>
  );
}

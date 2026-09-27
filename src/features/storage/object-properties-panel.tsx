import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/backup";
import { copyText } from "@/lib/clipboard";
import {
  type ObjectHead,
  type ObjectProperties,
  s3HeadObject,
  s3UpdateObjectProperties,
} from "@/lib/db";
import { ObjectPropertiesFields } from "./object-properties-fields";
import { errorText, formatDate, useStorageConnection } from "./use-storage-connection";

function toProperties(head: ObjectHead): ObjectProperties {
  return {
    content_type: head.content_type,
    cache_control: head.cache_control,
    content_disposition: head.content_disposition,
    content_encoding: head.content_encoding,
    content_language: head.content_language,
    expires: head.expires,
    storage_class: head.storage_class === "STANDARD" ? null : head.storage_class,
    server_side_encryption: head.server_side_encryption,
    kms_key_id: head.kms_key_id,
    metadata: { ...head.metadata },
  };
}

export function ObjectPropertiesPanel({
  bucket,
  objectKey,
  versionId,
  readOnly,
}: {
  bucket: string;
  objectKey: string;
  versionId: string | null;
  readOnly: boolean;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const head = useQuery({
    queryKey: ["s3", connection?.id, "head", bucket, objectKey, versionId],
    queryFn: () => s3HeadObject(url, bucket, objectKey, versionId),
  });
  const [draft, setDraft] = useState<ObjectProperties | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (head.data) setDraft(toProperties(head.data));
  }, [head.data]);

  if (head.isLoading || !draft) {
    return head.isError ? (
      <p className="text-sm break-words text-destructive">{errorText(head.error)}</p>
    ) : (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Lade Eigenschaften…
      </div>
    );
  }
  const data = head.data!;
  const facts: [string, string][] = [
    ["Schlüssel", data.key],
    ["Größe", `${formatBytes(data.size)} (${data.size.toLocaleString("de-DE")} Bytes)`],
    ["Geändert", formatDate(data.last_modified)],
    ["ETag", data.etag ?? "–"],
    ["Version", data.version_id ?? "–"],
    ["Speicherklasse", data.storage_class],
    ["Verschlüsselung", data.server_side_encryption ?? "keine"],
    ["Tags", String(data.tag_count)],
  ];
  if (data.replication_status) facts.push(["Replikation", data.replication_status]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await s3UpdateObjectProperties(url, bucket, objectKey, draft);
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
      toast.success("Eigenschaften gespeichert");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-xs">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd
              className="cursor-copy truncate font-mono"
              title={value}
              onClick={() => void copyText(value)}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <ObjectPropertiesFields value={draft} onChange={setDraft} disabled={readOnly} />
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? <Spinner className="size-4" /> : null}
            Speichern
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Kopiert das Objekt auf sich selbst (Metadaten ersetzen).
          </span>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Alle Antwort-Header</summary>
        <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-x-2 gap-y-0.5">
          {Object.entries(data.headers).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="truncate text-muted-foreground">{name}</dt>
              <dd className="truncate font-mono" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

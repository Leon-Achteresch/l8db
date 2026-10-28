import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Eye, FileText, Link2, MoveRight, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyWithToast } from "@/lib/clipboard";
import { type SupabaseBucket, supabaseDownloadObject, supabasePreviewObject } from "@/lib/db";
import {
  supabaseStudioStorageObjectInfo,
  supabaseStudioStoragePublicUrl,
  supabaseStudioStorageSignedUrl,
} from "@/lib/db/supabase-studio-storage";
import { BaasFilePreview } from "../../baas-file-preview";
import { formatBytes, formatDate, storageQueryKey } from "./storage-format";

const EXPIRIES = [
  { label: "1 Stunde", seconds: 3600 },
  { label: "1 Tag", seconds: 86_400 },
  { label: "1 Woche", seconds: 604_800 },
  { label: "1 Monat", seconds: 2_592_000 },
  { label: "1 Jahr", seconds: 31_536_000 },
];

export function SupabaseStorageObjectPanel({
  reference,
  bucket,
  objectKey,
  onTransfer,
  onDelete,
  onClose,
}: {
  reference: string;
  bucket: SupabaseBucket;
  objectKey: string;
  onTransfer: (copy: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [expiry, setExpiry] = useState(String(EXPIRIES[2].seconds));
  const [signed, setSigned] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const name = objectKey.split("/").at(-1) ?? objectKey;
  const info = useQuery({
    queryKey: storageQueryKey(reference, "info", bucket.id, objectKey),
    queryFn: () => supabaseStudioStorageObjectInfo(reference, bucket.id, objectKey),
  });
  const publicUrl = useQuery({
    queryKey: storageQueryKey(reference, "public-url", bucket.id, objectKey),
    queryFn: () => supabaseStudioStoragePublicUrl(reference, bucket.id, objectKey),
    enabled: bucket.public,
    staleTime: Number.POSITIVE_INFINITY,
  });

  async function download() {
    try {
      if (await supabaseDownloadObject(reference, bucket.id, objectKey))
        toast.success(`${name} gespeichert.`);
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  async function sign() {
    setSigning(true);
    try {
      const url = await supabaseStudioStorageSignedUrl(
        reference,
        bucket.id,
        objectKey,
        Number(expiry),
        false,
      );
      setSigned(url);
      await copyWithToast(url, "Signierte URL");
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setSigning(false);
    }
  }

  const userMetadata =
    info.data?.metadata && Object.keys(info.data.metadata).length > 0
      ? JSON.stringify(info.data.metadata, null, 2)
      : null;

  return (
    <aside className="space-y-4 rounded-xl border bg-background/50 p-4" aria-label="Datei-Details">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate" title={objectKey}>
            {name}
          </span>
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Details schließen" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      {info.isPending ? (
        <p className="text-xs text-muted-foreground">Details werden geladen…</p>
      ) : info.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(info.error)}
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Pfad</dt>
          <dd className="break-all font-mono">
            /{bucket.id}/{objectKey}
          </dd>
          <dt className="text-muted-foreground">Größe</dt>
          <dd>{formatBytes(info.data.size) || "–"}</dd>
          <dt className="text-muted-foreground">Typ</dt>
          <dd className="break-all">{info.data.content_type ?? "–"}</dd>
          <dt className="text-muted-foreground">Cache-Control</dt>
          <dd className="break-all">{info.data.cache_control ?? "–"}</dd>
          <dt className="text-muted-foreground">ETag</dt>
          <dd className="break-all font-mono">{info.data.etag ?? "–"}</dd>
          <dt className="text-muted-foreground">Erstellt</dt>
          <dd>{formatDate(info.data.created_at)}</dd>
          <dt className="text-muted-foreground">Geändert</dt>
          <dd>{formatDate(info.data.last_modified)}</dd>
          <dt className="text-muted-foreground">ID</dt>
          <dd className="break-all font-mono">{info.data.id ?? "–"}</dd>
          {userMetadata && (
            <>
              <dt className="text-muted-foreground">Metadaten</dt>
              <dd>
                <pre className="max-h-32 overflow-auto rounded border bg-card p-2 text-[11px]">
                  {userMetadata}
                </pre>
              </dd>
            </>
          )}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}>
          <Eye className="size-3.5" /> Vorschau
        </Button>
        <Button size="sm" variant="outline" onClick={() => void download()}>
          <Download className="size-3.5" /> Herunterladen
        </Button>
        <Button size="sm" variant="outline" onClick={() => onTransfer(false)}>
          <MoveRight className="size-3.5" /> Verschieben
        </Button>
        <Button size="sm" variant="outline" onClick={() => onTransfer(true)}>
          <Copy className="size-3.5" /> Kopieren
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete}>
          <Trash2 className="size-3.5" /> Löschen
        </Button>
      </div>
      {bucket.public && publicUrl.data && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Öffentliche URL</p>
          <div className="flex gap-1">
            <Input readOnly value={publicUrl.data} className="h-8 font-mono text-[11px]" />
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Öffentliche URL kopieren"
              onClick={() => void copyWithToast(publicUrl.data, "Öffentliche URL")}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Signierte URL</p>
        <div className="flex gap-1">
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger size="sm" className="h-8 w-32 text-xs" aria-label="Gültigkeit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRIES.map((entry) => (
                <SelectItem key={entry.seconds} value={String(entry.seconds)}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void sign()} disabled={signing}>
            <Link2 className="size-3.5" /> {signing ? "Erstellt…" : "Erstellen & kopieren"}
          </Button>
        </div>
        {signed && <Input readOnly value={signed} className="h-8 font-mono text-[11px]" />}
      </div>
      {previewing && (
        <BaasFilePreview
          name={name}
          queryKey={storageQueryKey(reference, "preview", bucket.id, objectKey)}
          load={() => supabasePreviewObject(reference, bucket.id, objectKey)}
          download={() => supabaseDownloadObject(reference, bucket.id, objectKey)}
          onClose={() => setPreviewing(false)}
        />
      )}
    </aside>
  );
}

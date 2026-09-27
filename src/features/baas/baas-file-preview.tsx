import { useQuery } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BaasFilePreview as BaasFilePreviewData } from "@/lib/db";
import { base64ToBytes } from "@/lib/value-viewers/binary";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function BaasFilePreview({
  name,
  queryKey,
  load,
  download,
  onClose,
}: {
  name: string;
  queryKey: readonly (string | number)[];
  load: () => Promise<BaasFilePreviewData>;
  download: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const preview = useQuery({ queryKey, queryFn: load, staleTime: 60_000 });
  const bytes = useMemo(
    () => (preview.data ? base64ToBytes(preview.data.base64) : null),
    [preview.data],
  );
  const mime = preview.data?.mime_type ?? "";
  const text =
    bytes && (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml")
      ? new TextDecoder().decode(bytes.subarray(0, 100 * 1024))
      : null;

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      setSaved(await download());
    } catch (reason) {
      setSaveError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold" title={name}>
            {name}
          </p>
          {preview.data && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {mime} · {preview.data.size.toLocaleString("de-DE")} Bytes
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dateivorschau schließen"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {preview.isPending ? (
        <p className="mt-4 text-xs text-muted-foreground">Datei wird geladen…</p>
      ) : preview.isError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {String(preview.error)}
        </p>
      ) : !bytes ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          Datei konnte nicht gelesen werden.
        </p>
      ) : IMAGE_TYPES.has(mime) ? (
        <img
          src={`data:${mime};base64,${preview.data.base64}`}
          alt={name}
          className="mt-4 max-h-96 max-w-full rounded-lg border object-contain"
        />
      ) : text !== null ? (
        <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-card p-3 text-xs">
          {text}
          {bytes.length > 100 * 1024 ? "\n… Vorschau gekürzt" : ""}
        </pre>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Für diesen Dateityp gibt es keine integrierte Vorschau.
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => void save()}
        disabled={saving}
      >
        <Download className="size-3.5" /> {saving ? "Speichere…" : "Datei speichern"}
      </Button>
      {saved && (
        <p role="status" className="mt-2 text-xs text-primary">
          Datei gespeichert.
        </p>
      )}
      {saveError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {saveError}
        </p>
      )}
    </div>
  );
}

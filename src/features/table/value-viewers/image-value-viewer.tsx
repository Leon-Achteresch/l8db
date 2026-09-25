import { useEffect, useState } from "react";
import { formatByteSize } from "@/lib/value-viewers/binary";
import type { ImageFormat } from "@/lib/value-viewers/image";

type ImageValueViewerProps = {
  format: ImageFormat;
  bytes: Uint8Array | null;
  text: string | null;
};

export function ImageValueViewer({ format, bytes, text }: ImageValueViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSize(null);
    setFailed(false);
    if (!bytes && text?.startsWith("data:")) {
      setUrl(text);
      return;
    }
    const part = bytes ? new Uint8Array(bytes) : text;
    if (part === null) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([part], { type: format.mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, text, format.mime]);
  const byteLength = bytes?.length ?? (text ? new Blob([text]).size : 0);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground" data-testid="image-info">
        {format.label}
        {size && ` · ${size.width} × ${size.height} px`}
        {byteLength > 0 && ` · ${formatByteSize(byteLength)}`}
      </span>
      <div className="flex h-[45vh] items-center justify-center overflow-auto rounded-lg border border-border/80 bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)] bg-[length:16px_16px] p-4">
        {failed ? (
          <p className="text-xs text-destructive">Bild konnte nicht dekodiert werden.</p>
        ) : (
          url && (
            <img
              src={url}
              alt="Vorschau"
              className="max-h-full max-w-full object-contain [image-rendering:auto]"
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
            />
          )
        )}
      </div>
    </div>
  );
}

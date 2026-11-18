import { CopyIcon, DownloadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copyText } from "@/lib/clipboard";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  BINARY_UTF8_MAX_BYTES,
  bytesToBase64,
  bytesToHex,
  type DecodedBinary,
  decodeBinaryUtf8,
  formatByteSize,
} from "@/lib/value-viewers/binary";
import { saveBytesToFile } from "@/lib/value-viewers/binary-file";
import type { ImageFormat } from "@/lib/value-viewers/image";
import { showCopiedMessage } from "@/lib/workspace-status";
import { HexDumpView } from "./hex-dump-view";

const BASE64_PREVIEW_BYTES = 256 * 1024;

type BinaryMode = "hex" | "base64" | "utf8";

const UTF8_STATUS = {
  empty: "Keine Bytes (leerer Wert)",
  invalid: "Die Bytes sind kein gültiges UTF-8.",
  "too-large": `Die UTF-8-Ansicht unterstützt bis zu ${formatByteSize(BINARY_UTF8_MAX_BYTES)}.`,
};

type BinaryValueViewerProps = {
  binary: DecodedBinary;
  image: ImageFormat | null;
  fileName: string;
};

export function BinaryValueViewer({ binary, image, fileName }: BinaryValueViewerProps) {
  const { bytes } = binary;
  const [selection, setSelection] = useState<{ mode: BinaryMode; bytes: Uint8Array }>({
    mode: "hex",
    bytes,
  });
  const mode = selection.mode === "utf8" && selection.bytes !== bytes ? "hex" : selection.mode;
  if (selection.bytes !== bytes) setSelection({ mode, bytes });
  const utf8Feature = useNewFeatureVisibility<HTMLButtonElement>("table.rows.binary.utf8");
  const utf8 = useMemo(() => (mode === "utf8" ? decodeBinaryUtf8(bytes) : null), [bytes, mode]);
  const base64Preview = useMemo(
    () => (mode === "base64" ? bytesToBase64(bytes.subarray(0, BASE64_PREVIEW_BYTES)) : ""),
    [bytes, mode],
  );
  const copy = async (text: string, label: string) => {
    try {
      await copyText(text);
      showCopiedMessage(`${label} kopiert`);
    } catch {
      toast.error(`${label} konnte nicht kopiert werden`);
    }
  };
  const handleSave = async () => {
    try {
      const saved = await saveBytesToFile(bytes, `${fileName}.${image?.extension ?? "bin"}`);
      if (saved) toast.success("Datei gespeichert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={mode}
            aria-label="Binärdarstellung"
            onValueChange={(next) => {
              if (next === "hex" || next === "base64" || next === "utf8")
                setSelection({ mode: next, bytes });
            }}
          >
            <ToggleGroupItem value="hex">Hex</ToggleGroupItem>
            <ToggleGroupItem value="base64">Base64</ToggleGroupItem>
            <ToggleGroupItem value="utf8" ref={utf8Feature.ref}>
              UTF-8-Text
              {utf8Feature.isNew && <NewBadge />}
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-xs text-muted-foreground" data-testid="binary-size">
            {formatByteSize(bytes.length)}
            {bytes.length >= 1024 && ` (${bytes.length.toLocaleString("de-DE")} Bytes)`}
            {binary.subType && ` · Subtyp ${binary.subType}`}
            {image && ` · ${image.label}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy(bytesToHex(bytes), "Hex")}
          >
            <CopyIcon className="size-3.5" />
            Hex
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy(bytesToBase64(bytes), "Base64")}
          >
            <CopyIcon className="size-3.5" />
            Base64
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleSave()}>
            <DownloadIcon className="size-3.5" />
            Speichern…
          </Button>
        </div>
      </div>
      {mode === "hex" ? (
        <HexDumpView bytes={bytes} />
      ) : utf8 ? (
        utf8.state === "text" ? (
          <section
            aria-label="UTF-8-Text"
            tabIndex={utf8.text.length > 0 ? 0 : undefined}
            className="max-h-[45vh] min-h-24 overflow-auto rounded-lg border border-border/80 bg-muted/45 p-4 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <pre className="select-text whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
              {utf8.text}
            </pre>
          </section>
        ) : (
          <p role="status" className="p-4 text-xs text-muted-foreground">
            {UTF8_STATUS[utf8.state]}
          </p>
        )
      ) : (
        <pre className="h-[45vh] overflow-auto rounded-lg border border-border/80 bg-muted/45 p-4 font-mono text-xs whitespace-pre-wrap break-all shadow-inner">
          {base64Preview}
          {bytes.length > BASE64_PREVIEW_BYTES && (
            <span className="block pt-2 text-muted-foreground italic">
              … gekürzt, vollständiger Wert über „Base64“ kopieren
            </span>
          )}
        </pre>
      )}
    </div>
  );
}

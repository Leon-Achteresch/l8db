import { CopyIcon, DownloadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copyText } from "@/lib/clipboard";
import {
  bytesToBase64,
  bytesToHex,
  type DecodedBinary,
  formatByteSize,
} from "@/lib/value-viewers/binary";
import { saveBytesToFile } from "@/lib/value-viewers/binary-file";
import type { ImageFormat } from "@/lib/value-viewers/image";
import { HexDumpView } from "./hex-dump-view";

const BASE64_PREVIEW_BYTES = 256 * 1024;

type BinaryValueViewerProps = {
  binary: DecodedBinary;
  image: ImageFormat | null;
  fileName: string;
};

export function BinaryValueViewer({ binary, image, fileName }: BinaryValueViewerProps) {
  const [mode, setMode] = useState<"hex" | "base64">("hex");
  const { bytes } = binary;
  const base64Preview = useMemo(
    () => (mode === "base64" ? bytesToBase64(bytes.subarray(0, BASE64_PREVIEW_BYTES)) : ""),
    [bytes, mode],
  );
  const copy = async (text: string, label: string) => {
    try {
      await copyText(text);
      toast.success(`${label} kopiert`);
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
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={mode}
            onValueChange={(next) => next && setMode(next as "hex" | "base64")}
          >
            <ToggleGroupItem value="hex">Hex</ToggleGroupItem>
            <ToggleGroupItem value="base64">Base64</ToggleGroupItem>
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

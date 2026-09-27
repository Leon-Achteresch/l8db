import { openUrl } from "@tauri-apps/plugin-opener";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { copyText } from "@/lib/clipboard";
import { s3Presign } from "@/lib/db";
import { basename } from "@/lib/storage/s3";
import type { BrowserRow } from "./use-object-listing";
import { errorText, useStorageConnection } from "./use-storage-connection";

const EXPIRY = [
  ["300", "5 Minuten"],
  ["3600", "1 Stunde"],
  ["86400", "1 Tag"],
  ["604800", "7 Tage (Maximum)"],
] as const;

export function PresignPanel({
  bucket,
  row,
  readOnly,
}: {
  bucket: string;
  row: BrowserRow;
  readOnly: boolean;
}) {
  const { url } = useStorageConnection();
  const [method, setMethod] = useState<"GET" | "PUT">("GET");
  const [expires, setExpires] = useState("3600");
  const [attachment, setAttachment] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const value = await s3Presign(url, bucket, row.key, {
        method,
        expiresSecs: Number(expires),
        versionId:
          method === "GET" && row.versionId && row.versionId !== "null" ? row.versionId : null,
        downloadName: method === "GET" && attachment ? basename(row.key) : undefined,
      });
      setLink(value);
      await copyText(value);
      toast.success("URL kopiert");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Signierte URL, mit der auch Personen ohne Zugangsdaten das Objekt abrufen
        {readOnly ? "" : " oder hochladen"} können.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Zweck</Label>
          <Select value={method} onValueChange={(value) => setMethod(value as "GET" | "PUT")}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">Herunterladen (GET)</SelectItem>
              {!readOnly && <SelectItem value="PUT">Hochladen (PUT)</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Gültigkeit</Label>
          <Select value={expires} onValueChange={setExpires}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {method === "GET" && (
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={attachment} onCheckedChange={setAttachment} />
          Als Download erzwingen (Content-Disposition)
        </label>
      )}
      <Button
        size="sm"
        className="justify-self-start"
        onClick={() => void generate()}
        disabled={busy}
      >
        {busy ? <Spinner className="size-4" /> : null}
        URL erzeugen
      </Button>
      {link && (
        <div className="grid gap-1.5">
          <Textarea
            aria-label="Presigned URL"
            readOnly
            className="min-h-24 font-mono text-[11px]"
            value={link}
          />
          <div className="flex gap-1.5">
            <Button size="xs" variant="outline" onClick={() => void copyText(link)}>
              <CopyIcon /> Kopieren
            </Button>
            {method === "GET" && (
              <Button size="xs" variant="outline" onClick={() => void openUrl(link)}>
                <ExternalLinkIcon /> Öffnen
              </Button>
            )}
          </div>
          {method === "PUT" && (
            <code className="rounded bg-muted p-2 text-[11px] break-all">
              curl -X PUT --upload-file {basename(row.key)} "{link}"
            </code>
          )}
        </div>
      )}
    </div>
  );
}

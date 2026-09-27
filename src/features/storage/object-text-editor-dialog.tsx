import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { s3GetObjectText, s3PutObjectText } from "@/lib/db";
import type { BrowserRow } from "./use-object-listing";
import { errorText, useStorageConnection } from "./use-storage-connection";

export function ObjectTextEditorDialog({
  bucket,
  row,
  onClose,
}: {
  bucket: string;
  row: BrowserRow | null;
  onClose: () => void;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const content = useQuery({
    queryKey: ["s3", connection?.id, "text", bucket, row?.key],
    queryFn: () => s3GetObjectText(url, bucket, row!.key),
    enabled: row !== null,
    gcTime: 0,
  });

  useEffect(() => {
    if (content.data !== undefined) setText(content.data);
  }, [content.data]);

  useEffect(() => {
    if (row) setError(null);
  }, [row]);

  const isJson = row?.key.toLowerCase().endsWith(".json") ?? false;

  async function save() {
    if (!row) return;
    if (isJson) {
      try {
        JSON.parse(text);
      } catch (e) {
        setError(`Ungültiges JSON: ${errorText(e)}`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await s3PutObjectText(url, bucket, row.key, text);
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
      toast.success(`${row.name} gespeichert`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{row?.name}</DialogTitle>
          <DialogDescription className="truncate">
            s3://{bucket}/{row?.key} · Speichern überschreibt das Objekt (neue Version bei
            Versionierung).
          </DialogDescription>
        </DialogHeader>
        {content.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Lade Inhalt…
          </div>
        ) : content.isError ? (
          <p className="text-sm text-destructive">{errorText(content.error)}</p>
        ) : (
          <Textarea
            aria-label="Objektinhalt"
            className="min-h-80 flex-1 resize-none font-mono text-xs"
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
        {error ? <p className="text-xs break-words text-destructive">{error}</p> : null}
        <DialogFooter>
          {isJson && (
            <Button
              variant="outline"
              className="mr-auto"
              onClick={() => {
                try {
                  setText(JSON.stringify(JSON.parse(text), null, 2));
                } catch (e) {
                  setError(`Ungültiges JSON: ${errorText(e)}`);
                }
              }}
            >
              JSON formatieren
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || content.isLoading || content.isError}
          >
            {busy ? <Spinner className="size-4" /> : null}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

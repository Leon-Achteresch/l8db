import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { s3GetObjectText, s3HeadObject, s3PutObjectText } from "@/lib/db";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { ObjectReadError } from "./object-read-error";
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
  const [conflict, setConflict] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [etag, setEtag] = useState<string | null>(null);
  const content = useQuery({
    queryKey: ["s3", connection?.id, "text", bucket, row?.key],
    queryFn: row ? () => s3GetObjectText(url, bucket, row.key) : skipToken,
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    if (content.data !== undefined) setText(content.data);
  }, [content.data]);

  useEffect(() => {
    if (row) {
      setError(null);
      setConflict(false);
      setEtag(row.etag);
    }
  }, [row]);

  const isJson = row?.key.toLowerCase().endsWith(".json") ?? false;
  const dirty = content.data !== undefined && text !== content.data;

  function close() {
    if (busy) return;
    if (dirty) setDiscarding(true);
    else onClose();
  }

  async function save(force = false) {
    if (!row) return;
    if (isJson) {
      try {
        JSON.parse(text);
      } catch {
        setError("Kein gültiges JSON.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await s3PutObjectText(url, bucket, row.key, text, undefined, force ? null : etag);
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
      toast.success(`${row.name} gespeichert`);
      onClose();
    } catch (e) {
      if (/PreconditionFailed/.test(errorText(e))) setConflict(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      const head = await s3HeadObject(url, bucket, row.key);
      const fresh = await content.refetch({ throwOnError: true });
      setEtag(head.etag);
      if (fresh.data !== undefined) setText(fresh.data);
      setConflict(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{row?.name}</DialogTitle>
          <DialogDescription className="truncate">
            s3://{bucket}/{row?.key}
          </DialogDescription>
        </DialogHeader>
        {content.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Lade Inhalt…
          </div>
        ) : content.isError ? (
          <ObjectReadError
            error={content.error}
            busy={busy || content.isFetching}
            onRetry={() => (conflict ? void reload() : void content.refetch())}
          />
        ) : (
          <Textarea
            aria-label="Objektinhalt"
            className="min-h-80 flex-1 resize-none font-mono text-xs"
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
        {error && (!content.isError || error !== errorText(content.error)) ? (
          <p className="text-xs break-words text-destructive">{error}</p>
        ) : null}
        {conflict && !content.isError ? (
          <div className="flex items-center gap-2 text-xs text-destructive">
            Das Objekt wurde inzwischen geändert.
            <Button size="xs" variant="outline" onClick={() => void reload()} disabled={busy}>
              Neu laden
            </Button>
            <Button size="xs" variant="outline" onClick={() => void save(true)} disabled={busy}>
              Trotzdem überschreiben
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          {isJson && (
            <Button
              variant="outline"
              className="mr-auto"
              disabled={busy || content.isPending || content.isError}
              onClick={() => {
                try {
                  setText(JSON.stringify(JSON.parse(text), null, 2));
                } catch {
                  setError("Kein gültiges JSON.");
                }
              }}
            >
              JSON formatieren
            </Button>
          )}
          <Button variant="outline" onClick={close}>
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
      <ConfirmActionDialog
        open={discarding}
        title="Änderungen verwerfen?"
        description={row?.name ?? ""}
        confirmLabel="Verwerfen"
        onOpenChange={setDiscarding}
        onConfirm={async () => onClose()}
      />
    </Dialog>
  );
}

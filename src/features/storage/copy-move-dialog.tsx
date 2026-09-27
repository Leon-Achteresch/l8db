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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { s3CopyObjects, s3ListBuckets } from "@/lib/db";
import { transferItem } from "./use-object-actions";
import type { BrowserRow } from "./use-object-listing";
import { errorText, useStorageConnection } from "./use-storage-connection";

export function CopyMoveDialog({
  bucket,
  prefix,
  request,
  onClose,
}: {
  bucket: string;
  prefix: string;
  request: { rows: BrowserRow[]; move: boolean } | null;
  onClose: () => void;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState(bucket);
  const [destination, setDestination] = useState(prefix);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buckets = useQuery({
    queryKey: ["s3", connection?.id, "buckets"],
    queryFn: () => s3ListBuckets(url),
    enabled: request !== null && Boolean(url),
  });

  useEffect(() => {
    if (request) {
      setTarget(bucket);
      setDestination(prefix);
      setError(null);
    }
  }, [request, bucket, prefix]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await s3CopyObjects(
        url,
        bucket,
        request.rows.map(transferItem),
        target,
        destination.trim(),
        request.move,
      );
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id] });
      if (outcome.errors.length) {
        setError(
          `${outcome.deleted} übertragen, ${outcome.errors.length} Fehler:\n${outcome.errors.slice(0, 5).join("\n")}`,
        );
        return;
      }
      toast.success(`${outcome.deleted} Objekt(e) ${request.move ? "verschoben" : "kopiert"}`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const verb = request?.move ? "Verschieben" : "Kopieren";
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {request?.rows.length ?? 0} Einträge {verb.toLowerCase()}
            </DialogTitle>
            <DialogDescription>
              Serverseitige Kopie (CopyObject). Ordner werden rekursiv übertragen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="copy-target-bucket">Ziel-Bucket</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="copy-target-bucket" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {(buckets.data ?? [{ name: bucket, creation_date: null }]).map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="copy-target-prefix">Zielordner</Label>
            <Input
              id="copy-target-prefix"
              value={destination}
              placeholder="leer = Wurzel"
              onChange={(event) => setDestination(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-xs break-words whitespace-pre-wrap text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : null}
              {verb}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

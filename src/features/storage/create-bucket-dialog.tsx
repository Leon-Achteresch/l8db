import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { s3CreateBucket } from "@/lib/db";
import { errorText, useStorageConnection } from "./use-storage-connection";

export function CreateBucketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (bucket: string) => void;
}) {
  const { connection, url } = useStorageConnection();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [objectLock, setObjectLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const bucket = name.trim();
    if (!bucket) return;
    setBusy(true);
    setError(null);
    try {
      await s3CreateBucket(url, bucket, { region: region.trim() || undefined, objectLock });
      await queryClient.invalidateQueries({ queryKey: ["s3", connection?.id, "buckets"] });
      onOpenChange(false);
      setName("");
      setObjectLock(false);
      onCreated(bucket);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Bucket erstellen</DialogTitle>
            <DialogDescription>
              Kleinbuchstaben, Ziffern, Punkt und Bindestrich, 3–63 Zeichen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="bucket-name">Name</Label>
            <Input
              id="bucket-name"
              autoFocus
              value={name}
              placeholder="mein-bucket"
              onChange={(event) => setName(event.target.value.toLowerCase())}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bucket-region">Region (optional)</Label>
            <Input
              id="bucket-region"
              value={region}
              placeholder="Region der Verbindung"
              onChange={(event) => setRegion(event.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="flex flex-col gap-0.5">
              Object Lock aktivieren
              <span className="text-xs text-muted-foreground">
                Schaltet Versionierung ein und erlaubt WORM-Aufbewahrung. Nur beim Erstellen
                möglich.
              </span>
            </span>
            <Switch checked={objectLock} onCheckedChange={setObjectLock} aria-label="Object Lock" />
          </label>
          {error ? <p className="text-xs break-words text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Spinner className="size-4" /> : null}
              Erstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

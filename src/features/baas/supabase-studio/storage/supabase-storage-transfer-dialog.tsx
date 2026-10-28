import { useState } from "react";
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
import { supabaseStudioStorageTransfer } from "@/lib/db/supabase-studio-storage";

export function SupabaseStorageTransferDialog({
  reference,
  bucket,
  source,
  copy,
  onClose,
  onDone,
}: {
  reference: string;
  bucket: string;
  source: string;
  copy: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const folder = source.endsWith("/");
  const [targetBucket, setTargetBucket] = useState(bucket);
  const [destination, setDestination] = useState(source);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = copy ? "Kopieren" : "Verschieben / Umbenennen";

  async function submit() {
    const target = destination.trim().replace(/^\/+/, "");
    if (!target || folder !== target.endsWith("/")) {
      setError(
        folder
          ? "Der Zielordner muss mit '/' enden."
          : "Bitte einen Dateipfad ohne '/' am Ende eingeben.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const count = await supabaseStudioStorageTransfer(
        reference,
        bucket,
        source,
        targetBucket.trim(),
        target,
        copy,
      );
      toast.success(
        `${count} ${count === 1 ? "Datei" : "Dateien"} ${copy ? "kopiert" : "verschoben"}.`,
      );
      onDone();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{verb}</DialogTitle>
          <DialogDescription className="break-all">
            Quelle: /{bucket}/{source}
            {folder ? " (alle Dateien im Ordner, höchstens 1000)" : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-storage-transfer-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="storage-transfer-bucket">Ziel-Bucket</Label>
            <Input
              id="storage-transfer-bucket"
              value={targetBucket}
              onChange={(event) => setTargetBucket(event.target.value)}
              disabled={busy}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="storage-transfer-path">{folder ? "Zielordner" : "Zielpfad"}</Label>
            <Input
              id="storage-transfer-path"
              className="font-mono text-xs"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              disabled={busy}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-xs break-words text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" form="supabase-storage-transfer-form" disabled={busy}>
            {busy ? "Überträgt…" : copy ? "Kopieren" : "Verschieben"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

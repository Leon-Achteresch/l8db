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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SupabaseBucket } from "@/lib/db";
import type { SupabaseStorageBucketSettings } from "@/lib/db/supabase-studio-storage";

const UNITS = [
  { label: "KB", factor: 1024 },
  { label: "MB", factor: 1024 ** 2 },
  { label: "GB", factor: 1024 ** 3 },
];

function initialLimit(bytes: number | null | undefined) {
  if (!bytes) return { value: "", unit: 1 };
  const unit = [2, 1, 0].find((index) => bytes % UNITS[index].factor === 0) ?? 0;
  return { value: String(bytes / UNITS[unit].factor), unit };
}

export function SupabaseStorageBucketDialog({
  open,
  bucket,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  bucket: SupabaseBucket | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, settings: SupabaseStorageBucketSettings) => void;
}) {
  const limit = initialLimit(bucket?.file_size_limit);
  const [name, setName] = useState(bucket?.id ?? "");
  const [isPublic, setIsPublic] = useState(bucket?.public ?? false);
  const [limitValue, setLimitValue] = useState(limit.value);
  const [limitUnit, setLimitUnit] = useState(limit.unit);
  const [mimeTypes, setMimeTypes] = useState(bucket?.allowed_mime_types?.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = name.trim();
    if (!/^[A-Za-z0-9 _.-]{1,100}$/.test(trimmed) || trimmed === "." || trimmed === "..") {
      setError(
        "Bucket-Namen dürfen nur Buchstaben, Ziffern, Leerzeichen, '-', '_' und '.' enthalten.",
      );
      return;
    }
    const amount = limitValue.trim() ? Number(limitValue.replace(",", ".")) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      setError("Das Größenlimit muss eine positive Zahl sein.");
      return;
    }
    setError(null);
    onSubmit(trimmed, {
      public: isPublic,
      fileSizeLimit: amount === null ? null : Math.round(amount * UNITS[limitUnit].factor),
      allowedMimeTypes: mimeTypes
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bucket ? `Bucket ${bucket.name} bearbeiten` : "Neuer Bucket"}</DialogTitle>
          <DialogDescription>
            Zugriff, Größenlimit und erlaubte Dateitypen gelten für alle Uploads in diesen Bucket.
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-storage-bucket-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="storage-bucket-name">Name</Label>
            <Input
              id="storage-bucket-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={Boolean(bucket) || busy}
              placeholder="avatars"
              required
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="storage-bucket-public">Öffentlicher Bucket</Label>
              <p className="text-xs text-muted-foreground">
                Dateien sind ohne Anmeldung über ihre öffentliche URL abrufbar.
              </p>
            </div>
            <Switch
              id="storage-bucket-public"
              checked={isPublic}
              onCheckedChange={setIsPublic}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="storage-bucket-limit">Maximale Dateigröße</Label>
            <div className="flex gap-2">
              <Input
                id="storage-bucket-limit"
                inputMode="decimal"
                value={limitValue}
                onChange={(event) => setLimitValue(event.target.value)}
                placeholder="Kein Limit"
                disabled={busy}
              />
              <Select
                value={String(limitUnit)}
                onValueChange={(value) => setLimitUnit(Number(value))}
                disabled={busy}
              >
                <SelectTrigger className="w-24" aria-label="Einheit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((unit, index) => (
                    <SelectItem key={unit.label} value={String(index)}>
                      {unit.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="storage-bucket-mime">Erlaubte MIME-Typen</Label>
            <Textarea
              id="storage-bucket-mime"
              value={mimeTypes}
              onChange={(event) => setMimeTypes(event.target.value)}
              placeholder="image/*, application/pdf (leer = alle)"
              rows={2}
              disabled={busy}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" form="supabase-storage-bucket-form" disabled={busy}>
            {busy ? "Speichert…" : bucket ? "Speichern" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

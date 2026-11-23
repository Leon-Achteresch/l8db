import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SavedQueryOriginChoice } from "@/features/query/saved-query-origin-choice";
import {
  type SavedQueryOrigin,
  savedQueryOriginForSave,
  savedQueryOriginKey,
} from "@/lib/saved-query-origin";

interface SaveQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, origin: SavedQueryOrigin | null) => void;
  origin?: SavedQueryOrigin;
  existingNames?: string[];
}

export function SaveQueryDialog({
  open,
  onOpenChange,
  onSave,
  existingNames = [],
  origin,
}: SaveQueryDialogProps) {
  const [name, setName] = useState("");
  const [originKey, setOriginKey] = useState<string | null>(null);
  const currentOriginKey = savedQueryOriginKey(origin);
  const rememberOrigin = currentOriginKey !== null && originKey === currentOriginKey;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setOriginKey(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const overwrite = existingNames.some(
    (existing) => existing.toLowerCase() === name.trim().toLowerCase(),
  );

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, savedQueryOriginForSave(origin, originKey));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Query speichern</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="query-name">Name</Label>
          <Input
            id="query-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Meine Query…"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          {overwrite && (
            <p className="text-xs text-muted-foreground">
              Name vorhanden: SQL und Herkunft werden ersetzt.
            </p>
          )}
        </div>
        <SavedQueryOriginChoice
          origin={origin}
          checked={rememberOrigin}
          onCheckedChange={(checked) => setOriginKey(checked ? currentOriginKey : null)}
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim()}>
            {overwrite ? "Überschreiben" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

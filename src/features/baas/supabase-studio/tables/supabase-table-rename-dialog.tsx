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

export function SupabaseTableRenameDialog({
  current,
  onOpenChange,
  onRename,
}: {
  current: string;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onRename(name.trim());
      onOpenChange(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current} umbenennen</DialogTitle>
          <DialogDescription>
            Abfragen, Richtlinien und Funktionen, die den alten Namen im Text verwenden, werden
            nicht angepasst.
          </DialogDescription>
        </DialogHeader>
        <form
          id="supabase-table-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Neuer Name"
            autoFocus
            spellCheck={false}
            className="font-mono"
          />
        </form>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            form="supabase-table-rename-form"
            disabled={busy || !name.trim() || name.trim() === current}
          >
            {busy ? "Speichert…" : "Umbenennen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

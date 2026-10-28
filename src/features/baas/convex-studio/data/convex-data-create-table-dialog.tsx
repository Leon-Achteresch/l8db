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

const TABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function ConvexDataCreateTableDialog({
  onOpenChange,
  onCreate,
}: {
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = TABLE_NAME.test(name.trim());

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
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
          <DialogTitle>Tabelle erstellen</DialogTitle>
          <DialogDescription>
            Leere Tabelle ohne Schema. Ist im Deployment ein Schema aktiv, wird die Tabelle beim
            nächsten Push entfernt, wenn sie dort fehlt.
          </DialogDescription>
        </DialogHeader>
        <form
          id="convex-data-create-table-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void submit();
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Tabellenname"
            placeholder="tabellenname"
            autoFocus
            spellCheck={false}
            className="font-mono"
          />
        </form>
        {name.trim() && !valid && (
          <p className="text-xs text-destructive">
            Nur Buchstaben, Ziffern und _, beginnend mit einem Buchstaben (max. 64 Zeichen).
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" form="convex-data-create-table-form" disabled={busy || !valid}>
            {busy ? "Erstellt…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

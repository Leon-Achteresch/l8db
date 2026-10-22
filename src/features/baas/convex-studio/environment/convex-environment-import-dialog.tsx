import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { convexStudioSettingsEnvImport } from "@/lib/db/convex-studio-settings";
import type { ConvexStudioDeployment } from "../convex-studio-sections";

export function ConvexEnvironmentImportDialog({
  deployment,
  onClose,
  onImported,
}: {
  deployment: ConvexStudioDeployment;
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await convexStudioSettingsEnvImport(deployment, text, overwrite);
      toast.success(
        `${result.applied.length} Variable(n) gesetzt${result.skipped.length ? `, ${result.skipped.length} vorhandene übersprungen` : ""}.`,
      );
      onImported();
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Aus .env importieren</DialogTitle>
            <DialogDescription className="text-xs">
              Zeilen im Format NAME=Wert. Kommentare (#), „export“ und Anführungszeichen werden
              unterstützt. Die Werte werden direkt im Deployment gesetzt.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-48 font-mono text-xs"
            placeholder={'API_URL=https://example.com\nSECRET="wert mit leerzeichen"'}
            aria-label=".env-Inhalt"
            spellCheck={false}
            autoComplete="off"
          />
          <label htmlFor="convex-env-overwrite" className="flex items-center gap-2 text-xs">
            <Checkbox
              id="convex-env-overwrite"
              checked={overwrite}
              onCheckedChange={(checked) => setOverwrite(checked === true)}
            />
            Vorhandene Variablen überschreiben
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm" disabled={busy || !text.trim()}>
              {busy ? "Importiert…" : "Importieren"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

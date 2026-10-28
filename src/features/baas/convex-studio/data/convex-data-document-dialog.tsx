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
import { JsonEditor } from "@/features/table/json-editor/json-editor";
import { parseDocuments } from "./convex-data-utils";

export type ConvexDocumentDialogMode = "insert" | "edit" | "patch";

const TEXT: Record<
  ConvexDocumentDialogMode,
  { title: string; description: string; action: string }
> = {
  insert: {
    title: "Dokumente einfügen",
    description:
      "Ein JSON-Objekt oder ein Array von Objekten. _id und _creationTime werden von Convex vergeben.",
    action: "Einfügen",
  },
  edit: {
    title: "Dokument bearbeiten",
    description:
      "Das Dokument wird vollständig ersetzt: Felder, die hier fehlen, werden entfernt. _id und _creationTime bleiben erhalten.",
    action: "Speichern",
  },
  patch: {
    title: "Felder setzen",
    description:
      "Die Felder dieses JSON-Objekts werden in allen ausgewählten Dokumenten gesetzt oder überschrieben. Andere Felder bleiben unverändert.",
    action: "Felder setzen",
  },
};

export function ConvexDataDocumentDialog({
  mode,
  table,
  initial,
  count,
  onOpenChange,
  onSubmit,
}: {
  mode: ConvexDocumentDialogMode;
  table: string;
  initial: string;
  count?: number;
  onOpenChange: (open: boolean) => void;
  onSubmit: (documents: Record<string, unknown>[]) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = TEXT[mode];
  let invalid: string | null = null;
  try {
    parseDocuments(text, mode === "insert");
  } catch (cause) {
    invalid = cause instanceof Error ? cause.message : String(cause);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parseDocuments(text, mode === "insert"));
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {copy.title} · <span className="font-mono">{table}</span>
            {mode === "patch" && count ? ` (${count} Dokumente)` : ""}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <JsonEditor
          text={text}
          onChange={setText}
          readOnly={busy}
          columnName={table}
          className="h-[50vh] min-h-64"
        />
        {invalid && <p className="text-xs text-destructive">{invalid}</p>}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={busy || invalid !== null}>
            {busy ? "Läuft…" : copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

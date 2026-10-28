import { Copy, Link2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { JsonEditor } from "@/features/table/json-editor/json-editor";
import { copyWithToast } from "@/lib/clipboard";
import type { ConvexDocument } from "@/lib/db/convex-studio-data";
import { formatCreationTime, idReferences } from "./convex-data-utils";

export function ConvexDataDocumentSheet({
  entry,
  resolving,
  onClose,
  onOpenReference,
  onEdit,
  onDelete,
}: {
  entry: { table: string; document: ConvexDocument } | null;
  resolving: string | null;
  onClose: () => void;
  onOpenReference: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const document = entry?.document;
  const references = document ? idReferences(document) : [];

  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-3 sm:max-w-2xl">
        {entry && document && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-sm">{entry.table}</SheetTitle>
              <SheetDescription className="grid gap-0.5 text-xs">
                <span className="font-mono break-all">{document._id}</span>
                <span>Erstellt {formatCreationTime(document._creationTime)}</span>
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-wrap gap-1 px-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyWithToast(JSON.stringify(document, null, 2), "Dokument")}
              >
                <Copy className="size-3.5" /> JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyWithToast(document._id, "_id")}
              >
                <Copy className="size-3.5" /> _id
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyWithToast(String(document._creationTime), "_creationTime")}
              >
                <Copy className="size-3.5" /> _creationTime
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="size-3.5" /> Bearbeiten
              </Button>
              <Button variant="destructive" size="sm" onClick={onDelete}>
                <Trash2 className="size-3.5" /> Löschen
              </Button>
            </div>
            <JsonEditor
              key={document._id}
              text={JSON.stringify(document, null, 2)}
              readOnly
              columnName={entry.table}
              className="mx-4 min-h-0 flex-1"
            />
            {references.length > 0 && (
              <div className="grid max-h-48 gap-1 overflow-auto px-4 pb-4">
                <p className="text-xs font-medium">Referenzen</p>
                {references.map((reference) => (
                  <button
                    key={`${reference.path}:${reference.id}`}
                    type="button"
                    disabled={resolving !== null}
                    onClick={() => onOpenReference(reference.id)}
                    className="flex min-w-0 items-center gap-2 rounded px-1 text-left text-xs hover:bg-muted disabled:opacity-60"
                  >
                    <Link2 className="size-3 shrink-0" />
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {reference.path}
                    </span>
                    <span className="truncate font-mono text-primary underline-offset-2 hover:underline">
                      {resolving === reference.id ? "wird geöffnet…" : reference.id}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

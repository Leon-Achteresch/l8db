import { BracesIcon, CopyIcon, DatabaseIcon, Loader2Icon, PencilIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  type CellDraft,
  describeCellDraft,
  detectCellEditorKind,
  formatJsonDraft,
  isCellDraftDirty,
  toCellDraft,
  validateCellDraft,
  valueToText,
} from "@/lib/cell-editor";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type CellValueDialogProps = {
  columnName: string;
  value: unknown;
  dataType?: string | null;
  canEdit: boolean;
  isSaving: boolean;
  onSave: (next: string | null) => Promise<void>;
  onClose: () => void;
};

export function CellValueDialog({
  columnName,
  value,
  dataType,
  canEdit,
  isSaving,
  onSave,
  onClose,
}: CellValueDialogProps) {
  const kind = useMemo(() => detectCellEditorKind(value, dataType), [value, dataType]);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<CellDraft>(() =>
    toCellDraft(value, detectCellEditorKind(value, dataType)),
  );

  const validation = validateCellDraft(draft, kind);
  const isDirty = isCellDraftDirty(value, draft, kind);
  const canApply = canEdit && isEditing && validation.ok && isDirty && !isSaving;

  const handleCopy = () => {
    void copyText(valueToText(value));
    toast.success("Kopiert!");
  };

  const handleFormat = () => {
    const formatted = formatJsonDraft(draft.text);
    if (formatted === null) {
      toast.error("Ungültiges JSON, Formatierung nicht möglich.");
      return;
    }
    setDraft({ text: formatted, isNull: false });
  };

  const handleApply = async () => {
    if (!canApply) return;
    await onSave(draft.isNull ? null : draft.text);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl sm:max-w-2xl border border-border bg-popover shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <DatabaseIcon className="size-4 text-primary" />
            Spalte: <span className="font-mono text-primary font-bold">{columnName}</span>
            {kind === "json" && (
              <span className="inline-flex items-center gap-1 rounded border border-border bg-muted/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                <BracesIcon className="size-3" />
                JSON
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 my-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {isEditing ? describeCellDraft(draft) : "Zellendetails"}
            </span>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                <CopyIcon className="size-3.5" />
                Kopieren
              </Button>
              {canEdit && !isEditing && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(toCellDraft(value, kind));
                    setIsEditing(true);
                  }}
                >
                  <PencilIcon className="size-3.5" />
                  Bearbeiten
                </Button>
              )}
              {isEditing && kind === "json" && !draft.isNull && (
                <Button type="button" variant="outline" size="sm" onClick={handleFormat}>
                  <BracesIcon className="size-3.5" />
                  Formatieren
                </Button>
              )}
              {isEditing && (
                <Button
                  type="button"
                  variant={draft.isNull ? "secondary" : "outline"}
                  size="sm"
                  onClick={() =>
                    setDraft((prev) =>
                      prev.isNull ? toCellDraft(value, kind) : { ...prev, isNull: true },
                    )
                  }
                >
                  NULL
                </Button>
              )}
            </div>
          </div>
          {isEditing ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={draft.isNull ? "" : draft.text}
                disabled={draft.isNull || isSaving}
                onChange={(e) => setDraft({ text: e.target.value, isNull: false })}
                spellCheck={false}
                placeholder={draft.isNull ? "NULL" : ""}
                className={cn(
                  "max-h-[55vh] min-h-64 resize-none font-mono text-xs leading-relaxed",
                  !validation.ok && "border-destructive focus-visible:ring-destructive/40",
                )}
              />
              {!validation.ok && (
                <p className="text-xs text-destructive font-mono">{validation.error}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => {
                    setDraft(toCellDraft(value, kind));
                    setIsEditing(false);
                  }}
                >
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!canApply}
                  onClick={() => void handleApply()}
                >
                  {isSaving && <Loader2Icon className="size-3.5 animate-spin" />}
                  Übernehmen
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-border/80 bg-muted/45 p-4 font-mono text-xs leading-relaxed shadow-inner">
              {value === null || value === undefined ? (
                <span className="text-muted-foreground italic">NULL</span>
              ) : typeof value === "object" ? (
                <pre className="text-purple-600 dark:text-purple-400 whitespace-pre-wrap [word-break:break-word]">
                  {valueToText(value)}
                </pre>
              ) : (
                <pre className="text-foreground whitespace-pre-wrap [word-break:break-word]">
                  {String(value)}
                </pre>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

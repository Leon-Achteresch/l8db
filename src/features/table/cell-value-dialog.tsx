import {
  BracesIcon,
  CopyIcon,
  DatabaseIcon,
  FileUpIcon,
  Loader2Icon,
  MapIcon,
  PencilIcon,
} from "lucide-react";
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
import {
  bytesToBase64,
  bytesToHexLiteral,
  formatByteSize,
  isBinaryDataType,
} from "@/lib/value-viewers/binary";
import { pickBytesFromFile } from "@/lib/value-viewers/binary-file";
import { isGeometryDataType, toEwkt, tryParseGeometry } from "@/lib/value-viewers/geometry";
import { ValueViewerPanel } from "./value-viewers/value-viewer-panel";

const LARGE_DRAFT = 256 * 1024;

type CellValueDialogProps = {
  columnName: string;
  value: unknown;
  dataType?: string | null;
  editorKind?: "text" | "json";
  canEdit: boolean;
  isSaving: boolean;
  onSave: (next: string | null) => Promise<void>;
  onClose: () => void;
  getColumnValues?: () => unknown[];
};

export function CellValueDialog({
  columnName,
  value,
  dataType,
  editorKind,
  canEdit,
  isSaving,
  onSave,
  onClose,
  getColumnValues,
}: CellValueDialogProps) {
  const kind = useMemo(
    () => editorKind ?? detectCellEditorKind(value, dataType),
    [value, dataType, editorKind],
  );
  const geometryDraft = useMemo(() => {
    if (!isGeometryDataType(dataType) || typeof value !== "object" || value === null) return null;
    const parsed = tryParseGeometry(value, dataType);
    return parsed ? { text: toEwkt(parsed), isNull: false } : null;
  }, [value, dataType]);
  const initialDraft = () => geometryDraft ?? toCellDraft(value, kind);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<CellDraft>(initialDraft);
  const [loadedFile, setLoadedFile] = useState<{ name: string; size: number } | null>(null);
  const isBinaryValue =
    isBinaryDataType(dataType) ||
    (typeof value === "string" && value.startsWith("\\x")) ||
    (typeof value === "object" && value !== null && "$binary" in value);
  const isGeometryValue =
    isGeometryDataType(dataType) ||
    (typeof value === "object" && value !== null && "coordinates" in value);

  const validation = validateCellDraft(draft, kind);
  const isDirty = geometryDraft
    ? draft.isNull || draft.text !== geometryDraft.text
    : isCellDraftDirty(value, draft, kind);
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

  const handleLoadFile = async () => {
    try {
      const file = await pickBytesFromFile();
      if (!file) return;
      const binData =
        typeof value === "object" && value !== null
          ? (value as { $binary?: { subType?: string } }).$binary
          : undefined;
      const text = binData
        ? JSON.stringify({
            $binary: { base64: bytesToBase64(file.bytes), subType: binData.subType ?? "00" },
          })
        : bytesToHexLiteral(file.bytes);
      setDraft({ text, isNull: false });
      setLoadedFile({ name: file.name, size: file.bytes.length });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleToWkt = () => {
    const parsed = tryParseGeometry(draft.text, dataType);
    if (!parsed) {
      toast.error("Wert konnte nicht als Geometrie gelesen werden.");
      return;
    }
    setDraft({ text: toEwkt(parsed), isNull: false });
  };

  const resetDraft = () => {
    setDraft(initialDraft());
    setLoadedFile(null);
  };

  const handleApply = async () => {
    if (!canApply) return;
    await onSave(draft.isNull ? null : draft.text);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl sm:max-w-3xl border border-border bg-popover shadow-lg">
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
            {dataType && (
              <span className="rounded border border-border bg-muted/60 px-1.5 py-px font-mono text-[10px] font-normal text-muted-foreground">
                {dataType}
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
                    resetDraft();
                    setIsEditing(true);
                  }}
                >
                  <PencilIcon className="size-3.5" />
                  Bearbeiten
                </Button>
              )}
              {isEditing && isBinaryValue && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => void handleLoadFile()}
                >
                  <FileUpIcon className="size-3.5" />
                  Datei laden…
                </Button>
              )}
              {isEditing && isGeometryValue && !draft.isNull && (
                <Button type="button" variant="outline" size="sm" onClick={handleToWkt}>
                  <MapIcon className="size-3.5" />
                  Als WKT
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
                  onClick={() => {
                    setLoadedFile(null);
                    setDraft((prev) => (prev.isNull ? initialDraft() : { ...prev, isNull: true }));
                  }}
                >
                  NULL
                </Button>
              )}
            </div>
          </div>
          {isEditing ? (
            <div className="flex flex-col gap-2">
              {loadedFile || (!draft.isNull && draft.text.length > LARGE_DRAFT && isBinaryValue) ? (
                <div className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs">
                  <span className="font-medium">
                    {loadedFile ? `Datei „${loadedFile.name}“` : "Großer Binärwert"}
                  </span>
                  <span className="text-muted-foreground">
                    {formatByteSize(loadedFile?.size ?? Math.floor((draft.text.length - 2) / 2))} ·
                    wird beim Übernehmen gespeichert
                  </span>
                </div>
              ) : (
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
              )}
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
                    resetDraft();
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
            <ValueViewerPanel
              value={value}
              dataType={dataType}
              columnName={columnName}
              getColumnValues={getColumnValues}
              textView={
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
              }
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyWithToast } from "@/lib/clipboard";
import { cellText } from "./supabase-tables-utils";

export function SupabaseTableCellDialog({
  cell,
  onClose,
}: {
  cell: { column: string; dataType: string; value: unknown } | null;
  onClose: () => void;
}) {
  const text = cell ? cellText(cell.value) : "";
  return (
    <Dialog open={Boolean(cell)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{cell?.column}</DialogTitle>
          <DialogDescription>
            {cell?.dataType || "Unbekannter Typ"}
            {cell?.value === null || cell?.value === undefined ? " · NULL" : ""}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">
          {cell?.value === null || cell?.value === undefined ? "NULL" : text}
        </pre>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => void copyWithToast(text, "Wert")}>
            <Copy className="size-3.5" /> Kopieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

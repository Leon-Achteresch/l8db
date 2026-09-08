import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { copyText } from "@/lib/clipboard";

export function QueryCellInspector({
  cell,
  onClose,
}: {
  cell: { column: string; value: unknown; row: number } | null;
  onClose: () => void;
}) {
  const value =
    cell?.value == null
      ? "NULL"
      : typeof cell.value === "object"
        ? JSON.stringify(cell.value, null, 2)
        : String(cell.value);
  return (
    <Sheet
      open={cell !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{cell?.column}</SheetTitle>
          <SheetDescription>Zeile {cell?.row} · Vollständiger Zellwert</SheetDescription>
        </SheetHeader>
        <pre className="mx-4 min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-4 font-mono text-xs whitespace-pre-wrap break-words">
          {value}
        </pre>
        <Button
          className="m-4"
          onClick={async () => {
            try {
              await copyText(value);
              toast.success("Zellwert kopiert");
            } catch {
              toast.error("Zellwert konnte nicht kopiert werden");
            }
          }}
        >
          Wert kopieren
        </Button>
      </SheetContent>
    </Sheet>
  );
}

import { ClipboardCopyIcon, CopyPlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { serializeSelectionCell } from "@/lib/grid-selection";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { TableRow } from "../data-table-types";

export type MenuRow = {
  ctid: string;
  rowIndex: number;
  original: TableRow;
};

type Props = {
  menuRow: MenuRow;
  rowOffset: number;
  columns: string[];
  canDuplicate: boolean;
  duplicateDisabled: boolean;
  onDuplicate: () => void;
  onDeleteRow?: (ctid: string, oldValues: Record<string, unknown>) => void;
};

export function DataTableRowMenu({
  menuRow,
  rowOffset,
  columns,
  canDuplicate,
  duplicateDisabled,
  onDuplicate,
  onDeleteRow,
}: Props) {
  return (
    <ContextMenuContent>
      <ContextMenuLabel className="font-mono text-[11px]">
        Zeile {menuRow.rowIndex + 1 + rowOffset}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => {
          const text = columns
            .map((id) => serializeSelectionCell(menuRow.original[id]))
            .join("\t");
          void copyText(text);
          toast.success("Zeile kopiert.");
        }}
      >
        <ClipboardCopyIcon />
        Zeile kopieren
      </ContextMenuItem>
      {canDuplicate && (
        <ContextMenuItem disabled={duplicateDisabled} onClick={onDuplicate}>
          <CopyPlusIcon />
          Zeile duplizieren
        </ContextMenuItem>
      )}
      {onDeleteRow && (
        <ContextMenuItem
          variant="destructive"
          onClick={() => onDeleteRow(menuRow.ctid, menuRow.original)}
        >
          <Trash2Icon />
          Zeile löschen
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}

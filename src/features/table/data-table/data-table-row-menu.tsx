import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { copyWithToast } from "@/lib/clipboard";
import { serializeSelectionCell } from "@/lib/grid-selection";
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
      <ContextMenuLabel className="font-mono">
        Zeile {menuRow.rowIndex + 1 + rowOffset}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>Kopieren als</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem
            onSelect={() =>
              void copyWithToast(
                columns.map((id) => serializeSelectionCell(menuRow.original[id])).join("\t"),
                "Zeile",
              )
            }
          >
            Tabulatorgetrennt
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void copyWithToast(
                JSON.stringify(
                  Object.fromEntries(columns.map((id) => [id, menuRow.original[id] ?? null])),
                  (_, value) => (typeof value === "bigint" ? value.toString() : value),
                  2,
                ),
                "Zeile",
              )
            }
          >
            JSON
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {canDuplicate && (
        <ContextMenuItem disabled={duplicateDisabled} onSelect={onDuplicate}>
          Zeile duplizieren
        </ContextMenuItem>
      )}
      {onDeleteRow && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => onDeleteRow(menuRow.ctid, menuRow.original)}
          >
            Zeile löschen
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

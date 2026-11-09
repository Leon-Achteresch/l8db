import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
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
import type { InsertExportInput } from "@/lib/export";
import { serializeSelectionCell } from "@/lib/grid-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { TableRow } from "../data-table-types";
import { copyRowsAsInsert, saveRowsAsInsert } from "./rows-insert-script";

export type MenuRow = {
  ctid: string;
  rowIndex: number;
  original: TableRow;
};

type Props = {
  menuRow: MenuRow;
  selectedRows: TableRow[];
  insertTarget?: Omit<InsertExportInput, "rows">;
  rowOffset: number;
  columns: string[];
  canDuplicate: boolean;
  duplicateDisabled: boolean;
  onDuplicate: () => void;
  onWatch?: () => void;
  onDeleteRow?: (ctid: string, oldValues: Record<string, unknown>) => void;
  extraItems?: ReactNode;
};

export function DataTableRowMenu({
  menuRow,
  selectedRows,
  insertTarget,
  rowOffset,
  columns,
  canDuplicate,
  duplicateDisabled,
  onDuplicate,
  onDeleteRow,
  onWatch,
  extraItems,
}: Props) {
  const insertFeature = useNewFeatureVisibility<HTMLDivElement>("table.rows.insert-script");
  const multiple = selectedRows.length > 1;
  const label = multiple ? `${selectedRows.length} Zeilen` : "Zeile";
  const insertInput = insertTarget && { ...insertTarget, rows: selectedRows };
  return (
    <ContextMenuContent>
      <ContextMenuLabel className="font-mono">
        {multiple ? label : `Zeile ${menuRow.rowIndex + 1 + rowOffset}`}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      {extraItems}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          {multiple ? `${label} kopieren als` : "Kopieren als"}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem
            onSelect={() =>
              void copyWithToast(
                selectedRows
                  .map((row) => columns.map((id) => serializeSelectionCell(row[id])).join("\t"))
                  .join("\n"),
                label,
              )
            }
          >
            Tabulatorgetrennt
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const objects = selectedRows.map((row) =>
                Object.fromEntries(columns.map((id) => [id, row[id] ?? null])),
              );
              void copyWithToast(
                JSON.stringify(
                  multiple ? objects : objects[0],
                  (_, value) => (typeof value === "bigint" ? value.toString() : value),
                  2,
                ),
                label,
              );
            }}
          >
            JSON
          </ContextMenuItem>
          {insertInput && (
            <ContextMenuItem ref={insertFeature.ref} onSelect={() => copyRowsAsInsert(insertInput)}>
              INSERT-SQL
              {insertFeature.isNew && <NewBadge className="ml-auto" />}
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {insertInput && (
        <ContextMenuItem onSelect={() => void saveRowsAsInsert(insertInput)}>
          {multiple ? `${label} als INSERT-SQL exportieren…` : "Als INSERT-SQL exportieren…"}
        </ContextMenuItem>
      )}
      {onWatch && <ContextMenuItem onSelect={onWatch}>Datensatz beobachten</ContextMenuItem>}
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

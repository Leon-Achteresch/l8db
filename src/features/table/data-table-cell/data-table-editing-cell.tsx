import { useContext } from "react";
import { useColumnValueOptions } from "@/lib/queries";
import { EditTargetContext } from "../data-table/edit-target-context";
import type { DataTableRowProps } from "../data-table-row";

const focusEditInput = (el: HTMLInputElement | null) => {
  el?.focus();
  el?.select();
};

const focusEditSelect = (el: HTMLSelectElement | null) => {
  el?.focus();
};

export function DataTableEditingCell({
  editingCell,
  isSaving,
  setEditingCell,
  commitEditingCell,
  width,
}: Pick<DataTableRowProps, "isSaving" | "setEditingCell" | "commitEditingCell"> & {
  editingCell: NonNullable<DataTableRowProps["editingCell"]>;
  width: number;
}) {
  const target = useContext(EditTargetContext);
  const valueOptions = useColumnValueOptions(
    target?.schema ?? "",
    target?.table ?? "",
    target !== null,
  );
  const options = valueOptions[editingCell.columnId];
  const choices =
    options && editingCell.value !== "" && !options.includes(editingCell.value)
      ? [editingCell.value, ...options]
      : options;
  const setValue = (value: string) => setEditingCell((prev) => (prev ? { ...prev, value } : prev));
  return (
    <td
      style={{ width }}
      className="px-0 py-0 align-top border-b border-r border-primary/40 relative overflow-hidden bg-primary/[0.04]"
    >
      <div className="flex flex-col">
        {choices ? (
          <select
            ref={focusEditSelect}
            aria-label={`Wert für ${editingCell.columnId}`}
            value={editingCell.value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => {
              if (e.currentTarget.isConnected) commitEditingCell();
            }}
            disabled={isSaving}
            className="w-full min-w-0 h-8 px-2 bg-transparent font-mono text-[13px] text-foreground outline-none border-0 focus:ring-0 disabled:opacity-60"
          >
            <option value="">NULL</option>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            ref={focusEditInput}
            value={editingCell.value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => {
              if (e.currentTarget.isConnected) commitEditingCell();
            }}
            disabled={isSaving}
            placeholder="NULL"
            className="w-full min-w-0 h-8 px-3 bg-transparent font-mono text-[13px] text-foreground outline-none border-0 focus:ring-0 placeholder:text-muted-foreground/35 disabled:opacity-60"
          />
        )}
        <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap border-t border-border/40 px-3 py-1 text-[11px] text-muted-foreground select-none">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted/80 px-1 py-px font-mono text-[10px] leading-none">
              ↵
            </kbd>
            <span>Speichern</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted/80 px-1 py-px font-mono text-[10px] leading-none">
              esc
            </kbd>
            <span>Abbrechen</span>
          </span>
        </div>
      </div>
    </td>
  );
}

import type { Column } from "@tanstack/react-table";
import type { ClipboardEvent } from "react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DuplicatePrefill } from "@/lib/row-duplicate";
import { planPasteSpread } from "@/lib/row-duplicate";
import { cn } from "@/lib/utils";
import type { TableRow } from "./data-table-types";

type DataTableDraftRowProps = {
  columns: Column<TableRow>[];
  fields: DuplicatePrefill;
  disabled: boolean;
  onChange: (fields: DuplicatePrefill) => void;
};

export function DataTableDraftRow({ columns, fields, disabled, onChange }: DataTableDraftRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      rowRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const handlePaste = (columnId: string, event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const text = event.clipboardData.getData("text") || event.clipboardData.getData("text/plain");
    if (!text || !/[\t\n\r]/.test(text)) return;
    event.preventDefault();
    const editableColumns = columns
      .map((column) => column.id)
      .filter((id) => id !== "__row_index__" && Object.hasOwn(fields, id));
    const plan = planPasteSpread(text, editableColumns, columnId);
    if (!plan.assignments.length) return;
    let next = fields;
    for (const assignment of plan.assignments) {
      next = {
        ...next,
        [assignment.column]: {
          ...next[assignment.column],
          mode: assignment.mode,
          value: assignment.value,
        },
      };
    }
    onChange(next);
    const messages: string[] = [];
    if (plan.droppedRows > 0) {
      messages.push(
        `Nur die erste Zeile wurde übernommen (${plan.droppedRows} weitere). Für mehrere Zeilen „Tabellenblock einfügen“ verwenden.`,
      );
    }
    if (plan.droppedCells > 0) {
      messages.push(`${plan.droppedCells} Wert(e) passten nicht in die verbleibenden Spalten.`);
    }
    if (messages.length) {
      toast.info("Beim Einfügen wurden Daten ausgelassen.", { description: messages.join(" ") });
    }
  };

  return (
    <tr ref={rowRef} data-draft-row className="bg-primary/5">
      {columns.map((column) => {
        const field = fields[column.id];
        const isIndex = column.id === "__row_index__";
        const pinned = column.getIsPinned() === "left";
        return (
          <td
            key={column.id}
            data-col={column.id}
            className={cn(
              "border-r border-b border-primary/25 px-2 py-2 align-top",
              pinned && "sticky z-10 bg-background",
            )}
            style={{ width: column.getSize(), left: pinned ? column.getStart("left") : undefined }}
          >
            {isIndex ? (
              <span title="Ungespeicherte neue Zeile" className="text-primary">
                *
              </span>
            ) : field ? (
              <div className="flex min-w-0 flex-col gap-1">
                <input
                  type="text"
                  aria-label={`${column.id} bearbeiten`}
                  value={field.mode === "value" ? field.value : ""}
                  placeholder={field.mode === "null" ? "NULL" : "Standardwert"}
                  disabled={disabled}
                  onPaste={(event) => handlePaste(column.id, event)}
                  onChange={(event) =>
                    onChange({
                      ...fields,
                      [column.id]: {
                        ...field,
                        mode: event.target.value === "" ? "default" : "value",
                        value: event.target.value,
                      },
                    })
                  }
                  className="h-8 w-full min-w-0 rounded border border-input bg-background px-1.5 font-mono text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                {field.isPrimaryKey && (
                  <span className="text-[10px] font-semibold text-primary">PK</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Automatisch</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

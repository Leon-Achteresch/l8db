import type { Column } from "@tanstack/react-table";
import { useEffect, useRef } from "react";
import type { DuplicateFieldMode, DuplicatePrefill } from "@/lib/row-duplicate";
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
                  aria-label={`${column.id} bearbeiten`}
                  value={field.mode === "value" ? field.value : ""}
                  placeholder={
                    field.mode === "default" ? "Standardwert" : field.mode === "null" ? "NULL" : ""
                  }
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...fields,
                      [column.id]: { ...field, mode: "value", value: event.target.value },
                    })
                  }
                  className="h-7 w-full min-w-0 rounded border border-input bg-background px-1.5 font-mono text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <div className="flex min-w-0 items-center gap-1">
                  {field.isPrimaryKey && (
                    <span className="text-[10px] font-semibold text-primary">PK</span>
                  )}
                  <select
                    aria-label={`${column.id} Wertmodus`}
                    value={field.mode}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange({
                        ...fields,
                        [column.id]: { ...field, mode: event.target.value as DuplicateFieldMode },
                      })
                    }
                    className="h-5 min-w-0 flex-1 rounded border border-input bg-background text-[10px] text-muted-foreground"
                  >
                    <option value="value">Wert</option>
                    <option value="null">NULL</option>
                    <option value="default">Standard</option>
                  </select>
                </div>
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

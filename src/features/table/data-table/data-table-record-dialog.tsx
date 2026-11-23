import { useVirtualizer } from "@tanstack/react-virtual";
import { useContext, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { numberCellText } from "@/lib/number-display";
import { useQueryQolSettings } from "@/lib/query-qol-settings";
import {
  TABLE_CELL_PREVIEW_LIMIT,
  tableCellPreview,
  truncateCellPreview,
} from "@/lib/table-cell-preview";
import { timestampCellText } from "@/lib/timestamp-display";
import { cn } from "@/lib/utils";
import type { TableRow } from "../data-table-types";
import { GridStyleContext } from "./grid-style-context";

type Props = {
  original: TableRow;
  columns: string[];
  columnTypeByName: Map<string, string>;
  rowNumber: number;
  onClose: () => void;
  returnFocus: () => void;
};

const FIELD_HEIGHT = 34;
const MAX_LIST_HEIGHT = 400;

export function DataTableRecordDialog({
  original,
  columns,
  columnTypeByName,
  rowNumber,
  onClose,
  returnFocus,
}: Props) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const numbers = useQueryQolSettings((state) => state.numbers);
  const timestamps = useQueryQolSettings((state) => state.timestamps);
  const { databaseKind } = useContext(GridStyleContext);
  const virtualizer = useVirtualizer({
    count: columns.length,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => columns[index],
    estimateSize: () => FIELD_HEIGHT,
    overscan: 5,
    useFlushSync: false,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const totalSize = virtualizer.getTotalSize();
  const height = Math.min(totalSize, MAX_LIST_HEIGHT);
  const scrollable = totalSize > (virtualizer.scrollRect?.height ?? height);
  const paddingBottom = totalSize - (items.at(-1)?.end ?? 0);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-xl sm:p-5"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader className="shrink-0 pr-9 text-left">
          <DialogTitle>Datensatz</DialogTitle>
          <DialogDescription>
            Zeile {rowNumber} · {columns.length} {columns.length === 1 ? "Feld" : "Felder"}
          </DialogDescription>
        </DialogHeader>
        <section
          ref={setScrollElement}
          aria-label="Feldliste"
          tabIndex={scrollable ? 0 : undefined}
          className="min-h-0 overflow-auto overscroll-contain rounded-md outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          style={{ height }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            virtualizer.scrollToIndex(event.key === "Home" ? 0 : columns.length - 1, {
              align: event.key === "Home" ? "start" : "end",
            });
          }}
        >
          <table
            aria-label="Felder"
            aria-rowcount={columns.length}
            className="w-full table-fixed border-separate border-spacing-0"
          >
            <tbody>
              {paddingTop > 0 && (
                <tr aria-hidden>
                  <td colSpan={2} style={{ height: paddingTop }} />
                </tr>
              )}
              {items.map((item) => {
                const name = columns[item.index];
                const value = Object.hasOwn(original, name) ? original[name] : undefined;
                const state =
                  value === undefined
                    ? "Nicht geladen"
                    : value === null
                      ? "NULL"
                      : value === ""
                        ? "Leerer Text"
                        : null;
                const formatted =
                  state === null
                    ? (numberCellText(value, numbers, columnTypeByName.get(name)) ??
                      timestampCellText(
                        value,
                        timestamps,
                        databaseKind,
                        columnTypeByName.get(name),
                      ))
                    : null;
                const text =
                  state ??
                  (formatted === null
                    ? tableCellPreview(value).text
                    : truncateCellPreview(formatted, TABLE_CELL_PREVIEW_LIMIT));
                return (
                  <tr
                    key={item.key}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    aria-rowindex={item.index + 1}
                    className={cn(
                      "align-top text-xs leading-5",
                      item.index % 2 === 0 && "bg-muted/30",
                    )}
                  >
                    <th
                      scope="row"
                      className="w-2/5 px-2 py-1.5 text-left font-mono font-normal text-muted-foreground [overflow-wrap:anywhere]"
                    >
                      {name}
                    </th>
                    <td
                      className={cn(
                        "px-2 py-1.5 select-text whitespace-pre-wrap tabular-nums [overflow-wrap:anywhere]",
                        state ? "text-muted-foreground italic" : "font-mono",
                      )}
                    >
                      {text}
                    </td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden>
                  <td colSpan={2} style={{ height: paddingBottom }} />
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </DialogContent>
    </Dialog>
  );
}

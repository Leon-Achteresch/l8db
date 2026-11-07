import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { CATEGORY_ICON, CATEGORY_LABEL } from "@/features/compare/data-compare-view/constants";
import { cellText } from "@/features/compare/data-compare-view/lib";
import type { DataDiffRow } from "@/lib/data-compare";

const ROW_HEIGHT = 28;

interface DataCompareRowsTableProps {
  rows: DataDiffRow[];
  keyColumns: string[];
  selected: Set<string>;
  onToggle: (keyText: string) => void;
  onSelectAll: (keys: string[], value: boolean) => void;
}

export function DataCompareRowsTable({
  rows,
  keyColumns,
  selected,
  onToggle,
  onSelectAll,
}: DataCompareRowsTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    useFlushSync: false,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const selectable = rows.filter((row) => row.category !== "equal").map((row) => row.keyText);
  const selectedCount = selectable.filter((key) => selected.has(key)).length;

  return (
    <div ref={scrollRef} className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="w-8 px-2 py-1">
              {selectable.length > 0 && (
                <Checkbox
                  aria-label="Alle sichtbaren Unterschiede auswählen"
                  checked={
                    selectedCount === selectable.length
                      ? true
                      : selectedCount > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={() =>
                    onSelectAll(selectable, selectedCount !== selectable.length)
                  }
                />
              )}
            </th>
            <th className="px-2 py-1 text-left font-medium">Kategorie</th>
            <th className="px-2 py-1 text-left font-medium">Schlüssel</th>
            <th className="px-2 py-1 text-left font-medium">Unterschiede</th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr style={{ height: padTop }} />}
          {items.map((item) => {
            const row = rows[item.index];
            const CategoryIcon = CATEGORY_ICON[row.category];
            const key = keyColumns
              .map((column) => `${column}=${cellText(row.keyValues[column])}`)
              .join(", ");
            const differences = row.differences
              .map((diff) => `${diff.column}: ${cellText(diff.left)} → ${cellText(diff.right)}`)
              .join(" | ");
            return (
              <tr key={row.keyText} style={{ height: ROW_HEIGHT }} className="border-t">
                <td className="px-2 py-1">
                  {row.category !== "equal" && (
                    <Checkbox
                      aria-label={`Zeile ${key} auswählen`}
                      checked={selected.has(row.keyText)}
                      onCheckedChange={() => onToggle(row.keyText)}
                    />
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <CategoryIcon className="size-3.5" />
                    {CATEGORY_LABEL[row.category]}
                  </span>
                </td>
                <td className="max-w-64 truncate px-2 py-1 font-mono" title={key}>
                  {key}
                </td>
                <td
                  className="max-w-md truncate px-2 py-1 font-mono text-muted-foreground"
                  title={differences}
                >
                  {differences}
                </td>
              </tr>
            );
          })}
          {padBottom > 0 && <tr style={{ height: padBottom }} />}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                Keine Zeilen in dieser Kategorie.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

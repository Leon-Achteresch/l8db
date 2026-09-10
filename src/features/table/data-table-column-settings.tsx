import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { ClipboardCopyIcon, EyeIcon, PinOffIcon, RotateCcwIcon } from "lucide-react";

import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { DataTableColumnSettingsItem } from "@/features/table/data-table-column-settings-item";
import { moveColumn } from "@/lib/table-column-prefs";

const sensors = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: () => false,
  }),
];

type DataTableColumnSettingsProps = {
  columns: string[];
  hidden: string[];
  pinned: string[];
  isCustomized: boolean;
  onToggle: (column: string) => void;
  onReorder: (order: string[]) => void;
  onReset: () => void;
  onShowAll: () => void;
  onUnpinAll: () => void;
  onCopyColumnNames: () => void;
};

export function DataTableColumnSettings({
  columns,
  hidden,
  pinned,
  isCustomized,
  onToggle,
  onReorder,
  onReset,
  onShowAll,
  onUnpinAll,
  onCopyColumnNames,
}: DataTableColumnSettingsProps) {
  const hiddenSet = new Set(hidden);
  const visibleCount = columns.length - hidden.length;

  return (
    <>
      <ContextMenuLabel>Spalten</ContextMenuLabel>
      <DragDropProvider
        sensors={sensors}
        onDragEnd={(event) => {
          const { operation, canceled } = event;
          if (canceled || !isSortable(operation.source)) return;
          const source = operation.source;
          if (source.initialIndex === source.index) return;
          onReorder(moveColumn(columns, source.initialIndex, source.index));
        }}
      >
        <div className="max-h-72 overflow-y-auto py-0.5">
          {columns.map((column, index) => (
            <DataTableColumnSettingsItem
              key={column}
              id={column}
              index={index}
              checked={!hiddenSet.has(column)}
              disabled={!hiddenSet.has(column) && visibleCount <= 1}
              onToggle={() => onToggle(column)}
            />
          ))}
        </div>
      </DragDropProvider>
      {hidden.length > 0 && (
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onShowAll();
          }}
        >
          <EyeIcon />
          Alle einblenden
        </ContextMenuItem>
      )}
      {pinned.length > 0 && (
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onUnpinAll();
          }}
        >
          <PinOffIcon />
          Fixierungen aufheben
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onCopyColumnNames}>
        <ClipboardCopyIcon />
        Spaltennamen kopieren
      </ContextMenuItem>
      {isCustomized && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onReset}>
            <RotateCcwIcon />
            Zurücksetzen
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

import { useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type DataTableColumnSettingsItemProps = {
  id: string;
  index: number;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
};

export function DataTableColumnSettingsItem({
  id,
  index,
  checked,
  disabled,
  onToggle,
}: DataTableColumnSettingsItemProps) {
  const { ref, handleRef, isDragging } = useSortable({ id, index });

  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-1 py-1",
        isDragging && "z-20 bg-accent opacity-80",
        !isDragging && "hover:bg-accent/70",
      )}
    >
      <button
        type="button"
        ref={handleRef}
        aria-label={`${id} verschieben`}
        className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={() => onToggle()}
        />
        <span className="truncate font-mono text-[12px]">{id}</span>
      </label>
    </div>
  );
}

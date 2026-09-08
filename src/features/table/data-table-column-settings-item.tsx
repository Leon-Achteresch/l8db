import { useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon } from "lucide-react";

import { SwitchButton } from "@/components/motion/switch-button";
import { cn } from "@/lib/utils";

type DataTableColumnSettingsItemProps = {
  id: string;
  index: number;
  checked: boolean;
  disabled: boolean;
  loading: boolean;
  onToggle: () => void;
};

export function DataTableColumnSettingsItem({
  id,
  index,
  checked,
  disabled,
  loading,
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
      <SwitchButton
        id={`column-visibility-${id}`}
        checked={checked}
        loading={loading}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={`${id} ${checked ? "ausblenden" : "einblenden"}`}
      />
      <label
        htmlFor={`column-visibility-${id}`}
        className={cn(
          "min-w-0 flex-1 cursor-pointer font-mono text-[12px]",
          (disabled || loading) && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="truncate font-mono text-[12px]">{id}</span>
      </label>
    </div>
  );
}

import { ChevronDownIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FIELD_MIME, type FieldPlacement } from "@/lib/chart-worksheet";
import { cn } from "@/lib/utils";

export function WorksheetPill({
  label,
  measure = false,
  placement,
  onRemove,
  onEdit,
  children,
}: {
  label: string;
  measure?: boolean;
  placement: FieldPlacement;
  onRemove: () => void;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  return (
    <span
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(FIELD_MIME, JSON.stringify(placement));
        event.dataTransfer.effectAllowed = "copyMove";
      }}
      className={cn(
        "inline-flex max-w-full cursor-grab items-center gap-1 rounded-md border pl-2 text-xs active:cursor-grabbing",
        measure
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
          : "border-blue-500/25 bg-blue-500/10 text-blue-800 dark:text-blue-200",
      )}
    >
      {children ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 py-1 font-medium"
              aria-label={`${label} einstellen`}
            >
              <span className="truncate">{label}</span>
              <ChevronDownIcon className="size-3 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            {children}
          </PopoverContent>
        </Popover>
      ) : onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="flex min-w-0 items-center gap-2 py-1 font-medium"
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-3 shrink-0" />
        </button>
      ) : (
        <span className="truncate py-1 font-medium">{label}</span>
      )}
      <IconButton
        aria-label={`${label} entfernen`}
        variant="ghost"
        size="icon-xs"
        className="size-6 shrink-0 rounded-sm text-current"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </IconButton>
    </span>
  );
}

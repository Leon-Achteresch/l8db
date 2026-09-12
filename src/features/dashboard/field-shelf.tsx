import { PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FIELD_MIME } from "@/lib/chart-worksheet";
import { cn } from "@/lib/utils";

export function FieldShelf({
  label,
  hint,
  children,
  onDrop,
  disabled = false,
  compact = false,
}: {
  label: string;
  hint: string;
  children?: ReactNode;
  onDrop: (data: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      role="group"
      aria-label={`Ablage ${label}`}
      data-field-shelf={label}
      onDragOver={(event) => {
        if (disabled || !event.dataTransfer.types.includes(FIELD_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) onDrop(event.dataTransfer.getData(FIELD_MIME));
      }}
      className={cn(
        "flex min-w-0 gap-3 rounded-lg border bg-card px-3 py-2 transition-colors",
        compact ? "flex-col" : "items-start",
        over && "border-primary bg-primary/10 ring-2 ring-primary/20",
        disabled && "opacity-50",
      )}
    >
      <span
        className={cn(
          "shrink-0 pt-1 text-xs font-semibold text-muted-foreground",
          !compact && "w-36",
        )}
      >
        {label}
      </span>
      <div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-2">
        {children || (
          <span className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <PlusIcon className="size-3" />
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

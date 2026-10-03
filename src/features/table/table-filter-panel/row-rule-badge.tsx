import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function RowRuleBadge({
  color,
  label,
  onRemove,
}: {
  color: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <Badge variant="secondary" className="min-w-0 gap-1.5 font-normal">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="max-w-[40vw] truncate font-mono text-xs sm:max-w-60" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Regel entfernen"
        className="-mr-0.5 rounded-sm opacity-70 hover:opacity-100"
      >
        <XIcon className="size-3" />
      </button>
    </Badge>
  );
}

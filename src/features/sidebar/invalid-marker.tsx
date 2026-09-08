import { XCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function InvalidMarker({
  label = "INVALID",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className={cn("inline-flex shrink-0 items-center text-destructive", className)}
    >
      <XCircleIcon className="size-3.5" strokeWidth={2.5} />
    </span>
  );
}

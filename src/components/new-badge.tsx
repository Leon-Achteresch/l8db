import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function NewBadge({ className }: Props) {
  return (
    <span
      role="img"
      aria-label="Neu"
      className={cn(
        "pointer-events-none inline-flex shrink-0 items-center rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide text-primary-foreground",
        className,
      )}
    >
      NEW
    </span>
  );
}

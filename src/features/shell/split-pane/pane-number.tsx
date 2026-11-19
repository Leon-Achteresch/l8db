import { cn } from "@/lib/utils";

export function PaneNumber({ index, className }: { index: number; className?: string }) {
  return (
    <span
      className={cn(
        "grid h-4 min-w-4 shrink-0 place-items-center rounded-sm bg-foreground/10 px-1 text-2xs leading-none font-medium text-muted-foreground tabular-nums",
        className,
      )}
    >
      {index + 1}
    </span>
  );
}

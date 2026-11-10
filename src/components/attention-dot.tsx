import { cn } from "@/lib/utils";

export function AttentionDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Handlungsbedarf"
      className={cn("size-2 shrink-0 rounded-full bg-blue-500", className)}
    />
  );
}

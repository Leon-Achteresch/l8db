import { cn } from "@/lib/utils";

export function ChangeCount({ value, type }: { value: number; type: "added" | "removed" }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        type === "added"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-600 dark:text-rose-400",
      )}
    >
      {type === "added" ? "+" : "−"}
      {value}
    </span>
  );
}

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export function TaskStatusIcon({ status, step }: { status: TaskStatus; step: number }) {
  if (status === "done" || status === "failed")
    return (
      <span
        className={cn(
          "flex size-[18px] items-center justify-center rounded-full text-white animate-in zoom-in-50 fade-in duration-300",
          status === "done" ? "bg-emerald-500" : "bg-destructive",
        )}
      >
        {status === "done" ? (
          <Check className="size-3" strokeWidth={3} />
        ) : (
          <X className="size-3" strokeWidth={3} />
        )}
      </span>
    );
  return (
    <span className="relative flex size-[18px] items-center justify-center">
      <svg
        viewBox="0 0 18 18"
        aria-hidden="true"
        className={cn(
          "absolute inset-0",
          status === "running" &&
            "animate-spin [animation-duration:1.1s] motion-reduce:animate-none",
        )}
      >
        <circle cx="9" cy="9" r="8" fill="none" stroke="var(--border)" strokeWidth="1.5" />
        {status === "running" && (
          <circle
            cx="9"
            cy="9"
            r="8"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="14 36.3"
          />
        )}
      </svg>
      <span
        className={cn(
          "relative text-[9.5px] font-semibold tabular-nums",
          status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {step}
      </span>
    </span>
  );
}

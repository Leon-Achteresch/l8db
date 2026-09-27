import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING_PANEL } from "@/lib/ease";
import { cn } from "@/lib/utils";

export function SetupStep({
  index,
  title,
  summary,
  state,
  action,
  children,
}: {
  index: number;
  title: string;
  summary?: ReactNode;
  state: "done" | "active" | "upcoming";
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      aria-current={state === "active" ? "step" : undefined}
      className="group/step relative flex gap-3 pb-5 last:pb-0"
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-7 bottom-1 left-3 w-px -translate-x-1/2 group-last/step:hidden",
          state === "done" ? "bg-primary/40" : "bg-border",
        )}
      />
      <span
        className={cn(
          "relative flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
          state === "done" && "bg-primary text-primary-foreground",
          state === "active" && "bg-background text-primary ring-2 ring-primary ring-inset",
          state === "upcoming" && "bg-muted text-muted-foreground",
        )}
      >
        {state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-6 items-center justify-between gap-2">
          <p className={cn("text-sm font-medium", state === "upcoming" && "text-muted-foreground")}>
            {title}
          </p>
          {action}
        </div>
        {state === "done" && summary ? (
          <p className="truncate text-xs text-muted-foreground">{summary}</p>
        ) : null}
        <AnimatePresence initial={false}>
          {state === "active" && children ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_PANEL}
              className="-mx-1 overflow-hidden px-1"
            >
              <div className="pt-3 pb-1">{children}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </li>
  );
}

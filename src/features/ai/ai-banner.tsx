import { CircleAlert, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AiBanner({
  tone,
  children,
  action,
  onClose,
  className,
}: {
  tone: "setup" | "error";
  children: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  className?: string | false;
}) {
  const Icon = tone === "setup" ? TriangleAlert : CircleAlert;
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "mx-3 flex shrink-0 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs",
        tone === "setup"
          ? "mt-1 bg-amber-500/10 text-foreground"
          : "mb-3 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          tone === "setup" && "text-amber-600 dark:text-amber-400",
        )}
      />
      <p className="max-h-28 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words">
        {children}
      </p>
      {action}
      {onClose && (
        <button
          type="button"
          aria-label="Fehler schließen"
          className="grid size-6 shrink-0 place-items-center rounded-md outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

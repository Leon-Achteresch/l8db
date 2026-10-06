import { useId } from "react";
import type { JoinKind } from "@/lib/dashboards";
import { cn } from "@/lib/utils";

export function JoinVenn({ kind, className }: { kind: JoinKind; className?: string }) {
  const clip = useId();
  return (
    <svg viewBox="0 0 36 22" aria-hidden="true" className={cn("h-4 w-6 shrink-0", className)}>
      <defs>
        <clipPath id={clip}>
          <circle cx="22" cy="11" r="8" />
        </clipPath>
      </defs>
      {kind === "left" && <circle cx="14" cy="11" r="8" className="fill-current opacity-70" />}
      <circle
        cx="14"
        cy="11"
        r="8"
        clipPath={`url(#${CSS.escape(clip)})`}
        className="fill-current"
      />
      <circle cx="14" cy="11" r="8" className="fill-none stroke-current" strokeWidth="1.4" />
      <circle cx="22" cy="11" r="8" className="fill-none stroke-current" strokeWidth="1.4" />
    </svg>
  );
}

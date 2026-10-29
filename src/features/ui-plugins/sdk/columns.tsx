import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const GAPS = ["gap-0", "gap-1", "gap-2", "gap-3", "gap-4"] as const;

export function Columns({ gap = 3, children }: { gap?: 0 | 1 | 2 | 3 | 4; children?: ReactNode }) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]",
        GAPS[gap] ?? GAPS[3],
      )}
    >
      {children}
    </div>
  );
}

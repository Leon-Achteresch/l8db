import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const GAPS = ["gap-0", "gap-1", "gap-2", "gap-3", "gap-4"] as const;
const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
} as const;
const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

export function Stack({
  direction = "row",
  gap = 1,
  align,
  justify,
  wrap = false,
  children,
}: {
  direction?: "row" | "column";
  gap?: 0 | 1 | 2 | 3 | 4;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0",
        direction === "column" ? "flex-col" : "flex-row",
        GAPS[gap] ?? GAPS[1],
        align ? ALIGN[align] : direction === "row" && "items-center",
        justify && JUSTIFY[justify],
        wrap && "flex-wrap",
      )}
    >
      {children}
    </div>
  );
}

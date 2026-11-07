import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui-plugins/api";
import { toneColor } from "@/lib/ui-plugins/tones";
import { cn } from "@/lib/utils";

const SIZES = { xs: "text-[11px]", sm: "text-xs", md: "text-sm" } as const;
const WEIGHTS = { normal: "font-normal", medium: "font-medium", bold: "font-semibold" } as const;

export function Text({
  tone,
  weight = "normal",
  size = "sm",
  mono = false,
  truncate = false,
  children,
}: {
  tone?: Tone | "muted";
  weight?: "normal" | "medium" | "bold";
  size?: "xs" | "sm" | "md";
  mono?: boolean;
  truncate?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "min-w-0",
        SIZES[size] ?? SIZES.sm,
        WEIGHTS[weight] ?? WEIGHTS.normal,
        mono ? "font-mono" : "font-sans",
        truncate && "truncate",
        tone === "muted" && "text-muted-foreground",
      )}
      style={tone && tone !== "muted" ? { color: toneColor(tone) } : undefined}
    >
      {children}
    </span>
  );
}

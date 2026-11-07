import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui-plugins/api";
import { toneColor } from "@/lib/ui-plugins/tones";

export function Card({
  title,
  tone,
  children,
}: {
  title?: ReactNode;
  tone?: Tone;
  children?: ReactNode;
}) {
  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card p-3 font-sans text-sm shadow-xs"
      style={tone ? { borderLeft: `3px solid ${toneColor(tone)}` } : undefined}
    >
      {title !== undefined && (
        <h3 className="mb-2 truncate text-xs font-semibold text-foreground/90">{title}</h3>
      )}
      {children}
    </section>
  );
}

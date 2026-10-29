import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui-plugins/api";
import { toneColor } from "@/lib/ui-plugins/tones";

export function Badge({ tone, children }: { tone?: Tone; children?: ReactNode }) {
  const color = toneColor(tone);
  return (
    <span
      className="inline-flex h-4 max-w-full shrink-0 items-center truncate rounded border px-1 font-sans text-[10px] font-semibold uppercase leading-none tracking-wide"
      style={{ color, borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}
    >
      {children}
    </span>
  );
}

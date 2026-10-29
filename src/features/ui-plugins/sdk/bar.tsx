import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui-plugins/api";
import { toneColor } from "@/lib/ui-plugins/tones";

export function Bar({
  value,
  max,
  tone = "info",
  label,
}: {
  value: number;
  max: number;
  tone?: Tone;
  label?: ReactNode;
}) {
  const ratio =
    Number.isFinite(value) && Number.isFinite(max) && max > 0
      ? Math.min(1, Math.max(0, value / max))
      : 0;
  const color = toneColor(tone);
  return (
    <span className="flex w-full min-w-0 items-center gap-1.5 font-sans text-[11px]">
      <span
        title={`${value} / ${max}`}
        className="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full"
        style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)` }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${ratio * 100}%`, backgroundColor: color }}
        />
      </span>
      {label !== undefined && (
        <span className="shrink-0 tabular-nums text-foreground/80">{label}</span>
      )}
    </span>
  );
}

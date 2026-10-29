import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui-plugins/api";
import { toneColor } from "@/lib/ui-plugins/tones";

export function SdkButton({
  onClick,
  tone = "neutral",
  variant = "outline",
  disabled = false,
  children,
}: {
  onClick?: () => void;
  tone?: Tone;
  variant?: "solid" | "outline" | "ghost";
  disabled?: boolean;
  children?: ReactNode;
}) {
  const color = toneColor(tone);
  const style =
    variant === "solid"
      ? { backgroundColor: color, borderColor: color, color: "white" }
      : variant === "ghost"
        ? { borderColor: "transparent", color }
        : { borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, color };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 font-sans text-xs font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
      style={style}
    >
      {children}
    </button>
  );
}

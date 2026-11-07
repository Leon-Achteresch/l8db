import type { Tone } from "./api";

export const TONE_COLORS: Record<Tone, string> = {
  neutral: "#64748b",
  info: "#3b82f6",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
};

export function toneColor(tone: unknown): string {
  return typeof tone === "string" && Object.hasOwn(TONE_COLORS, tone)
    ? TONE_COLORS[tone as Tone]
    : TONE_COLORS.neutral;
}

export function toneSoft(tone: unknown, percent = 14) {
  const color = toneColor(tone);
  return { color, backgroundColor: `color-mix(in oklab, ${color} ${percent}%, transparent)` };
}

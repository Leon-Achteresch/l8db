import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
export type LoaderVariant =
  | "spinner"
  | "dots"
  | "bars"
  | "dot-matrix"
  | "dither"
  | "ascii"
  | "ascii-line"
  | "ascii-braille"
  | "ascii-blocks"
  | "ascii-bounce"
  | "morph"
  | "comet"
  | "scramble"
  | "metaballs"
  | "newton"
  | "helix"
  | "percent";
export const ASCII_SETS: Record<string, string[]> = {
  ascii: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  "ascii-line": ["|", "/", "-", "\\"],
  "ascii-braille": ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  "ascii-blocks": ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
  "ascii-bounce": ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
};
export interface LoaderProps {
  variant?: LoaderVariant;
  size?: number;
  speed?: number;
  label?: string;
  className?: string;
}
export const REDUCED = {
  animate: { opacity: [1, 0.4, 1] },
  transition: { duration: 1.4, ease: EASE_IN_OUT, repeat: Infinity },
};
export interface PartProps {
  size: number;
  speed: number;
  reduce: boolean;
}
export const MORPH_POINTS = 24;
export function ngonRadius(ang: number, n: number, phase = 0) {
  const seg = (2 * Math.PI) / n;
  const a = ang - phase;
  const local = (((a % seg) + seg) % seg) - seg / 2;
  return Math.cos(Math.PI / n) / Math.cos(local);
}
export function morphPath(radiusAt: (ang: number) => number) {
  const parts: string[] = [];
  for (let i = 0; i < MORPH_POINTS; i++) {
    const ang = (i / MORPH_POINTS) * 2 * Math.PI - Math.PI / 2;
    const r = Math.min(1.05, radiusAt(ang));
    const x = (50 + Math.cos(ang) * 46 * r).toFixed(2);
    const y = (50 + Math.sin(ang) * 46 * r).toFixed(2);
    parts.push(`${i === 0 ? "M" : "L"}${x} ${y}`);
  }
  return `${parts.join(" ")} Z`;
}
export const MORPH_PATHS = [
  morphPath(() => 1),
  morphPath((a) => ngonRadius(a, 4, Math.PI / 4)),
  morphPath((a) => ngonRadius(a, 3)),
  morphPath((a) => ngonRadius(a, 6)),
  morphPath((a) => ngonRadius(a, 4)),
];
export const MORPH_SEQ = [...MORPH_PATHS.flatMap((p) => [p, p]), MORPH_PATHS[0]];
export const MORPH_ROT = [0, 0, 72, 72, 144, 144, 216, 216, 288, 288, 360];
export const MORPH_SCALE = [1, 1, 0.88, 0.88, 1, 1, 0.88, 0.88, 1, 1, 1];
export const COMET_TRAIL = [0, 1, 2, 3, 4, 5];
export const SCRAMBLE_TARGET = "LOADING";
export const SCRAMBLE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>/*#@";
export const NEWTON_BALLS = [0, 1, 2, 3, 4];
export const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

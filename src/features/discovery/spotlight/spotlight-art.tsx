import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = [
  "from-(--discovery-1) via-(--discovery-2) to-(--discovery-3)",
  "from-(--discovery-2) via-(--discovery-1) to-(--discovery-3)",
  "from-(--discovery-3) via-(--discovery-2) to-(--discovery-1)",
];

const ATLAS_LIT = new Set([2, 5, 9, 10, 16, 19, 23, 24, 26]);
const ATLAS_CELLS = Array.from({ length: 28 }, (_, i) => ({
  id: `cell-${i}`,
  x: 74 + (i % 7) * 26,
  y: 38 + Math.floor(i / 7) * 26,
  lit: ATLAS_LIT.has(i),
}));

const ART: Record<string, ReactNode> = {
  discover: (
    <>
      <circle cx="160" cy="90" r="58" />
      <circle cx="160" cy="90" r="38" strokeDasharray="2 6" />
      <path d="M160 52 L172 90 L160 128 L148 90 Z" fill="currentColor" fillOpacity=".18" />
      <path d="M160 52 L172 90 L148 90 Z" fill="currentColor" />
      <circle cx="218" cy="90" r="4" fill="currentColor" />
      <circle cx="102" cy="90" r="2.5" fill="currentColor" />
      <ellipse cx="160" cy="90" rx="110" ry="30" strokeOpacity=".35" />
    </>
  ),
  "discover.atlas": (
    <>
      {ATLAS_CELLS.map((cell) => (
        <rect
          key={cell.id}
          x={cell.x}
          y={cell.y}
          width="20"
          height="20"
          rx="5"
          fill="currentColor"
          fillOpacity={cell.lit ? 0.9 : 0.12}
          stroke="none"
        />
      ))}
    </>
  ),
  "discover.lessons": (
    <>
      <path d="M60 140 H110 V112 H160 V84 H210 V56 H260" />
      <circle cx="110" cy="140" r="7" fill="currentColor" />
      <circle cx="160" cy="112" r="7" fill="currentColor" />
      <circle cx="210" cy="84" r="7" fill="currentColor" fillOpacity=".25" />
      <circle cx="260" cy="56" r="12" />
      <path d="M254 56 l4 4 l8 -9" />
    </>
  ),
  "discover.guide": (
    <>
      <path d="M58 132 C110 132 120 70 168 82" strokeDasharray="3 7" />
      <circle cx="182" cy="86" r="22" strokeOpacity=".7" />
      <circle cx="182" cy="86" r="40" strokeOpacity=".35" />
      <circle cx="182" cy="86" r="58" strokeOpacity=".15" />
      <path
        d="M178 80 L178 116 L188 106 L196 122 L203 119 L195 103 L209 103 Z"
        fill="currentColor"
        strokeLinejoin="round"
      />
    </>
  ),
};

const FALLBACK = (
  <>
    <ellipse cx="160" cy="90" rx="100" ry="34" strokeOpacity=".4" />
    <ellipse cx="160" cy="90" rx="62" ry="20" strokeDasharray="2 6" />
    <path
      d="M160 56 C163 80 170 87 194 90 C170 93 163 100 160 124 C157 100 150 93 126 90 C150 87 157 80 160 56 Z"
      fill="currentColor"
    />
  </>
);

export function SpotlightArt({ id, index }: { id: string; index: number }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative aspect-video overflow-hidden rounded-xl bg-linear-to-br",
        TONES[index % TONES.length],
      )}
    >
      <div className="absolute inset-0 bg-radial-[circle_at_30%_20%] from-white/30 to-transparent to-60%" />
      <div className="discovery-grain absolute inset-0 opacity-40 mix-blend-overlay" />
      <svg
        aria-hidden="true"
        viewBox="0 0 320 180"
        className="absolute inset-0 h-full w-full text-white transition-transform duration-500 ease-smooth-out group-hover/card:scale-105 motion-reduce:transition-none"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        {ART[id] ?? FALLBACK}
      </svg>
    </div>
  );
}

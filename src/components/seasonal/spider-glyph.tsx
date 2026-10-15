import { motion } from "motion/react";

const LEGS = [
  "M16 21L9 13L5 18",
  "M14.5 25L6 20L2 26",
  "M14.5 29L6 30L3 36",
  "M16.5 33L10.5 38.5L8 44",
];

export function SpiderGlyph({ gaze }: { gaze: "scan" | "left" | "right" | "ahead" }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-11 overflow-visible text-foreground">
      <path d="M24 -1V18" className="stroke-muted-foreground/70" strokeWidth={1.1} />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {LEGS.map((leg) => (
          <path key={leg} d={leg} />
        ))}
        <g transform="matrix(-1 0 0 1 48 0)">
          {LEGS.map((leg) => (
            <path key={leg} d={leg} />
          ))}
        </g>
      </g>
      <circle cx="24" cy="27" r="10" fill="currentColor" />
      <circle cx="20" cy="25.5" r="3.4" className="fill-background" />
      <circle cx="28" cy="25.5" r="3.4" className="fill-background" />
      <motion.g
        fill="currentColor"
        animate={
          gaze === "scan"
            ? { x: [0, -1.5, 1.5, -1.5, 1.5, 0] }
            : { x: gaze === "left" ? -1.4 : gaze === "right" ? 1.4 : 0 }
        }
        transition={gaze === "scan" ? { duration: 1.4, ease: "easeInOut" } : { duration: 0.25 }}
      >
        <circle cx="20" cy="26" r="1.7" />
        <circle cx="28" cy="26" r="1.7" />
      </motion.g>
    </svg>
  );
}

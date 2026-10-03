import { motion } from "motion/react";

const BARS = [
  { id: "a", peak: 0.55, duration: 0.9, delay: 0 },
  { id: "b", peak: 1, duration: 0.7, delay: 0.15 },
  { id: "c", peak: 0.75, duration: 0.8, delay: 0.3 },
  { id: "d", peak: 0.95, duration: 0.65, delay: 0.1 },
  { id: "e", peak: 0.5, duration: 0.85, delay: 0.25 },
];

export function IslandWaveform({ color }: { color?: string }) {
  return (
    <span aria-hidden className="flex h-3.5 shrink-0 items-center gap-[2px]" style={{ color }}>
      {BARS.map((bar) => (
        <motion.span
          key={bar.id}
          className="h-full w-[2.5px] rounded-full bg-current"
          initial={{ scaleY: 0.3 }}
          animate={{ scaleY: [0.3, bar.peak, 0.3] }}
          transition={{
            duration: bar.duration,
            delay: bar.delay,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

import { motion } from "motion/react";
import { EASE_OUT } from "@/lib/ease";

const SPARKS = [
  { id: "a", x: -17, y: -7, color: "#f472b6" },
  { id: "b", x: -13, y: 8, color: "#facc15" },
  { id: "c", x: 15, y: -8, color: "#60a5fa" },
  { id: "d", x: 17, y: 6, color: "#34d399" },
  { id: "e", x: -2, y: -11, color: "#a78bfa" },
  { id: "f", x: 3, y: 11, color: "#fb923c" },
];

export function IslandEmoji({ emoji, effect }: { emoji: string; effect: "wave" | "pop" }) {
  const pop = effect === "pop";
  return (
    <span
      aria-hidden
      className="relative flex size-4 shrink-0 items-center justify-center text-[13px] leading-none"
    >
      {pop
        ? SPARKS.map((spark) => (
            <motion.span
              key={spark.id}
              className="absolute size-1 rounded-full"
              style={{ background: spark.color }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: spark.x, y: spark.y, opacity: 0, scale: 0.4 }}
              transition={{ duration: 0.75, ease: EASE_OUT, delay: 0.18 }}
            />
          ))
        : null}
      <motion.span
        className="inline-block"
        style={{ originX: 0.7, originY: 0.8 }}
        initial={pop ? { scale: 0.3, rotate: -20 } : { rotate: 0 }}
        animate={
          pop
            ? { scale: [0.3, 1.25, 1], rotate: [-20, 10, 0] }
            : { rotate: [0, 16, -8, 16, -4, 10, 0] }
        }
        transition={
          pop ? { duration: 0.5, ease: EASE_OUT } : { duration: 1.4, delay: 0.3, ease: "easeInOut" }
        }
      >
        {emoji}
      </motion.span>
    </span>
  );
}

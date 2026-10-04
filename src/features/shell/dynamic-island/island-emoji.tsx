import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/lib/ease";

const SPARKS = [
  { id: "a", x: -17, y: -7, color: "#f472b6" },
  { id: "b", x: -13, y: 8, color: "#facc15" },
  { id: "c", x: 15, y: -8, color: "#60a5fa" },
  { id: "d", x: 17, y: 6, color: "#34d399" },
  { id: "e", x: -2, y: -11, color: "#a78bfa" },
  { id: "f", x: 3, y: 11, color: "#fb923c" },
];
const POP = ["scale(0.3) rotate(-20deg)", "scale(1.25) rotate(10deg)", "scale(1) rotate(0deg)"];
const WAVE = [0, 16, -8, 16, -4, 10, 0].map((angle) => `rotate(${angle}deg)`);

export function IslandEmoji({ emoji, effect }: { emoji: string; effect: "wave" | "pop" }) {
  const reduce = useReducedMotion();
  const pop = effect === "pop";
  if (reduce)
    return (
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none"
      >
        {emoji}
      </span>
    );
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
              initial={{ transform: "translate(0px, 0px) scale(1)", opacity: 1 }}
              animate={{
                transform: `translate(${spark.x}px, ${spark.y}px) scale(0.4)`,
                opacity: 0,
              }}
              transition={{ duration: 0.75, ease: EASE_OUT, delay: 0.18 }}
            />
          ))
        : null}
      <motion.span
        className="inline-block origin-[70%_80%]"
        initial={{ transform: pop ? POP[0] : WAVE[0] }}
        animate={{ transform: pop ? POP : WAVE }}
        transition={
          pop ? { duration: 0.5, ease: EASE_OUT } : { duration: 1.4, delay: 0.3, ease: "easeInOut" }
        }
      >
        {emoji}
      </motion.span>
    </span>
  );
}

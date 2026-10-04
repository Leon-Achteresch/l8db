import { motion, useReducedMotion } from "motion/react";
import type { IslandTone } from "@/lib/dynamic-island";
import { cn } from "@/lib/utils";

const ISLAND_SPRING = { type: "spring", stiffness: 420, damping: 26, mass: 0.9 } as const;
const CAP = 14;
const BASE = 100;
const PART =
  "absolute top-0 left-1/2 h-7 border-border bg-card group-hover:bg-muted dark:border-white/10 dark:bg-black dark:group-hover:bg-neutral-900";
const GLOWS: [IslandTone, string][] = [
  ["success", "shadow-[0_0_18px_-1px_rgb(52_211_153/0.6)]"],
  ["error", "shadow-[0_0_18px_-1px_rgb(248_113_113/0.6)]"],
  ["warning", "shadow-[0_0_18px_-1px_rgb(251_191_36/0.55)]"],
  ["celebrate", "shadow-[0_0_22px_-1px_rgb(167_139_250/0.7)]"],
];

interface Props {
  width: number;
  tone: IslandTone;
  delay: number;
}

export function IslandPill({ width, tone, delay }: Props) {
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : { ...ISLAND_SPRING, delay };
  return (
    <div aria-hidden className="pointer-events-none">
      {GLOWS.map(([key, glow]) => (
        <span
          key={key}
          className={cn(
            "absolute top-0 left-1/2 h-7 -translate-x-1/2 rounded-full transition-opacity duration-300",
            glow,
          )}
          style={{
            width,
            opacity: tone === key ? 1 : 0,
            transitionDelay: tone === key ? "150ms" : "0ms",
          }}
        />
      ))}
      <motion.div
        className={cn(PART, "border-y")}
        style={{ width: BASE, marginLeft: -BASE / 2 }}
        initial={false}
        animate={{ transform: `scaleX(${Math.max(0.001, (width - 2 * CAP + 2) / BASE)})` }}
        transition={transition}
      />
      <motion.div
        className={cn(PART, "rounded-l-full border-y border-l")}
        style={{ width: CAP }}
        initial={false}
        animate={{ transform: `translateX(${-width / 2}px)` }}
        transition={transition}
      />
      <motion.div
        className={cn(PART, "rounded-r-full border-y border-r")}
        style={{ width: CAP }}
        initial={false}
        animate={{ transform: `translateX(${width / 2 - CAP}px)` }}
        transition={transition}
      />
    </div>
  );
}

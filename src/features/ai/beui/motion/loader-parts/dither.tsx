import { motion } from "motion/react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import { BAYER_4, type PartProps } from "./shared";

export function Dither({ size, speed, reduce }: PartProps) {
  const n = 4;
  const gap = Math.max(1, size * 0.05);
  const cell = (size - gap * (n - 1)) / n;
  return (
    <span className="grid" style={{ gap, gridTemplateColumns: `repeat(${n}, ${cell}px)` }}>
      {BAYER_4.map((order) => (
        <motion.span
          key={order}
          className="bg-current"
          style={{ width: cell, height: cell }}
          animate={reduce ? { opacity: [0.3, 1, 0.3] } : { opacity: [0.1, 1, 0.1] }}
          transition={{
            duration: speed,
            ease: EASE_IN_OUT,
            repeat: Infinity,
            delay: (order / BAYER_4.length) * speed,
          }}
        />
      ))}
    </span>
  );
}

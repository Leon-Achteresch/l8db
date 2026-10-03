import { motion } from "motion/react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import type { PartProps } from "./shared";

export function DotMatrix({ size, speed, reduce }: PartProps) {
  const n = 3;
  const gap = size * 0.14;
  const dot = (size - gap * (n - 1)) / n;
  const cells = Array.from({ length: n * n }, (_, idx) => idx);
  return (
    <span
      className="grid"
      style={{
        gap,
        gridTemplateColumns: `repeat(${n}, ${dot}px)`,
      }}
    >
      {cells.map((idx) => {
        const x = idx % n;
        const y = Math.floor(idx / n);
        const delay = ((x + y) / (2 * (n - 1))) * speed;
        return (
          <motion.span
            key={idx}
            className="rounded-full bg-current"
            style={{ width: dot, height: dot }}
            animate={
              reduce ? { opacity: [0.3, 1, 0.3] } : { opacity: [0.2, 1, 0.2], scale: [0.7, 1, 0.7] }
            }
            transition={{
              duration: speed,
              ease: EASE_IN_OUT,
              repeat: Infinity,
              delay,
            }}
          />
        );
      })}
    </span>
  );
}

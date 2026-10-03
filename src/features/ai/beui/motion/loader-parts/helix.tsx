import { motion } from "motion/react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import type { PartProps } from "./shared";

export function Helix({ size, speed, reduce }: PartProps) {
  const rows = 7;
  const dot = size * 0.14;
  const amp = size * 0.32;
  return (
    <span className="relative" style={{ width: size, height: size }}>
      {Array.from({ length: rows }, (_, r) => {
        const top = (r / (rows - 1)) * (size - dot);
        const delay = (r / rows) * speed;
        return (
          <span key={`row-${top}`}>
            <motion.span
              className="absolute rounded-full bg-current"
              style={{ width: dot, height: dot, left: size / 2 - dot / 2, top }}
              animate={
                reduce
                  ? { opacity: [0.4, 1, 0.4] }
                  : {
                      x: [amp, -amp, amp],
                      scale: [1, 0.5, 1],
                      opacity: [1, 0.45, 1],
                    }
              }
              transition={{
                duration: speed,
                ease: EASE_IN_OUT,
                repeat: Infinity,
                delay,
              }}
            />
            <motion.span
              className="absolute rounded-full bg-current"
              style={{ width: dot, height: dot, left: size / 2 - dot / 2, top }}
              animate={
                reduce
                  ? { opacity: [0.4, 1, 0.4] }
                  : {
                      x: [-amp, amp, -amp],
                      scale: [0.5, 1, 0.5],
                      opacity: [0.45, 1, 0.45],
                    }
              }
              transition={{
                duration: speed,
                ease: EASE_IN_OUT,
                repeat: Infinity,
                delay,
              }}
            />
          </span>
        );
      })}
    </span>
  );
}

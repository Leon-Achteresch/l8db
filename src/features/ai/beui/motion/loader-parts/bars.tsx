import { motion } from "motion/react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import type { PartProps } from "./shared";

export function Bars({ size, speed, reduce }: PartProps) {
  const bar = size * 0.16;
  return (
    <span className="flex items-center" style={{ gap: size * 0.1, height: size }}>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="rounded-full bg-current"
          style={{ width: bar, height: size, originY: 1 }}
          animate={reduce ? { opacity: [0.4, 1, 0.4] } : { scaleY: [0.3, 1, 0.3] }}
          transition={{
            duration: speed,
            ease: EASE_IN_OUT,
            repeat: Infinity,
            delay: i * speed * 0.12,
          }}
        />
      ))}
    </span>
  );
}

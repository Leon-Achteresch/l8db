import { motion } from "motion/react";
import { useId } from "react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import type { PartProps } from "./shared";

export function Metaballs({ size, speed, reduce }: PartProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img">
      <title>Loading</title>
      <defs>
        <filter id={id}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </defs>
      <g filter={`url(#${id})`} fill="currentColor">
        <motion.circle
          cy="50"
          r="15"
          animate={reduce ? { opacity: [0.4, 1, 0.4] } : { cx: [30, 70, 30] }}
          transition={{ duration: speed * 1.6, ease: EASE_IN_OUT, repeat: Infinity }}
          cx={reduce ? 40 : 30}
        />
        <motion.circle
          cy="50"
          r="15"
          animate={reduce ? { opacity: [0.4, 1, 0.4] } : { cx: [70, 30, 70] }}
          transition={{ duration: speed * 1.6, ease: EASE_IN_OUT, repeat: Infinity }}
          cx={reduce ? 60 : 70}
        />
      </g>
    </svg>
  );
}

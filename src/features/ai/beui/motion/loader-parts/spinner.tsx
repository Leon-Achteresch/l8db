import { motion } from "motion/react";
import { type PartProps, REDUCED } from "./shared";

export function Spinner({ size, speed, reduce }: PartProps) {
  const stroke = Math.max(2, size * 0.09);
  const r = (size - stroke) / 2;
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      animate={reduce ? REDUCED.animate : { rotate: 360 }}
      transition={
        reduce ? REDUCED.transition : { duration: speed, ease: "linear", repeat: Infinity }
      }
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={stroke}
      />
      <path
        d={`M ${size / 2} ${size / 2 - r} A ${r} ${r} 0 0 1 ${size / 2 + r} ${size / 2}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </motion.svg>
  );
}

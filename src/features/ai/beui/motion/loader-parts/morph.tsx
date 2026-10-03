import { motion } from "motion/react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import { MORPH_PATHS, MORPH_ROT, MORPH_SCALE, MORPH_SEQ, type PartProps } from "./shared";

export function Morph({ size, speed, reduce }: PartProps) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      animate={reduce ? { opacity: [1, 0.4, 1] } : { rotate: MORPH_ROT, scale: MORPH_SCALE }}
      transition={
        reduce
          ? { duration: 1.4, ease: EASE_IN_OUT, repeat: Infinity }
          : { duration: speed * 5, ease: EASE_IN_OUT, repeat: Infinity }
      }
    >
      <title>Loading</title>
      <motion.path
        fill="currentColor"
        d={MORPH_PATHS[0]}
        animate={reduce ? undefined : { d: MORPH_SEQ }}
        transition={
          reduce ? undefined : { duration: speed * 5, ease: EASE_IN_OUT, repeat: Infinity }
        }
      />
    </motion.svg>
  );
}

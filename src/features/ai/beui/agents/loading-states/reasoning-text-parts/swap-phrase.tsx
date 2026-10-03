import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT } from "@/features/ai/beui/lib/ease";
import { TEXT_SHIMMER_CLASS_NAME, textShimmerStyle } from "@/features/ai/beui/lib/text-shimmer";
import { cn } from "@/lib/utils";
import type { PhraseProps } from "./shared";

export function SwapPhrase({ phrase, reduce, shimmerDuration }: PhraseProps) {
  return (
    <AnimatePresence initial={false}>
      <motion.span
        key={phrase}
        className={cn(
          "col-start-1 row-start-1 inline-block justify-self-start whitespace-nowrap will-change-[opacity,transform]",
          TEXT_SHIMMER_CLASS_NAME,
        )}
        style={textShimmerStyle(shimmerDuration)}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 3 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
        transition={{
          duration: reduce ? 0.12 : 0.2,
          ease: EASE_OUT,
        }}
      >
        {phrase}…
      </motion.span>
    </AnimatePresence>
  );
}

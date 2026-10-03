import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT, SPRING_SWAP } from "@/features/ai/beui/lib/ease";
import { textCharacters } from "@/features/ai/beui/lib/text-characters";
import { TEXT_SHIMMER_CLASS_NAME, textShimmerStyle } from "@/features/ai/beui/lib/text-shimmer";
import { cn } from "@/lib/utils";
import { CASCADE_STAGGER, type PhraseProps } from "./shared";

export function CascadePhrase({ phrase, reduce, shimmerDuration }: PhraseProps) {
  const text = `${phrase}…`;
  if (reduce) {
    return (
      <span
        className={cn(
          "col-start-1 row-start-1 inline-block justify-self-start whitespace-pre",
          TEXT_SHIMMER_CLASS_NAME,
        )}
        style={textShimmerStyle(shimmerDuration)}
      >
        {text}
      </span>
    );
  }
  return (
    <AnimatePresence initial={false}>
      <motion.span
        key={phrase}
        className="col-start-1 row-start-1 inline-block justify-self-start whitespace-pre"
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {textCharacters(text).map(({ character, id }, characterIndex) => (
          <motion.span
            key={id}
            custom={characterIndex * CASCADE_STAGGER}
            variants={{
              initial: { opacity: 0, y: "100%" },
              animate: (delay: number) => ({
                opacity: 1,
                y: "0%",
                transition: { ...SPRING_SWAP, delay },
              }),
              exit: (delay: number) => ({
                opacity: 0,
                y: "-100%",
                transition: {
                  duration: 0.14,
                  ease: EASE_OUT,
                  delay: delay * 0.45,
                },
              }),
            }}
            className={cn(
              "inline-block whitespace-pre will-change-[opacity,transform]",
              TEXT_SHIMMER_CLASS_NAME,
            )}
            style={textShimmerStyle(shimmerDuration)}
          >
            {character}
          </motion.span>
        ))}
      </motion.span>
    </AnimatePresence>
  );
}

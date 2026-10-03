import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import { CitationRow } from "./citation-row";
import type { CitationListProps } from "./shared";

export function CitationList({ citations, idPrefix, className }: CitationListProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const resolvedPrefix = idPrefix ?? `citation-list-${baseId.replace(/:/g, "")}`;
  return (
    <div className={cn("grid gap-0.5", className)}>
      <AnimatePresence mode="popLayout">
        {citations.map((citation, index) => (
          <motion.div
            layout="position"
            key={citation.id}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.18, ease: EASE_OUT },
                    y: SPRING_LAYOUT,
                    layout: SPRING_LAYOUT,
                  }
            }
          >
            <CitationRow citation={citation} index={index + 1} idPrefix={resolvedPrefix} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SPRING_PANEL } from "@/lib/ease";
import type { Rect } from "@/lib/tour/placement";

interface Props {
  rect: Rect | null;
  waiting: boolean;
}

const PAD = 8;

export function TourSpotlight({ rect, waiting }: Props) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {rect ? (
        <motion.div
          key="spotlight"
          data-tour-ui="spotlight"
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-[10000000] rounded-[14px] shadow-[0_0_0_200vmax_rgba(8,10,16,0.62)]"
          initial={{
            opacity: 0,
            x: rect.left - PAD,
            y: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
          animate={{
            opacity: 1,
            x: rect.left - PAD,
            y: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : SPRING_PANEL}
        >
          <div
            data-waiting={waiting || undefined}
            className="tour-mascot-spotlight absolute inset-0 rounded-[inherit] ring-2 ring-primary/70"
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { SpiderGlyph } from "@/components/seasonal/spider-glyph";
import type { SpiderVisit } from "@/lib/seasonal";
import { cn } from "@/lib/utils";

const SIZE = 44;
const BUBBLE_WIDTH = 248;
const DROP_MS = 1100;
const LOOK_MS = 1500;
const LEAVE_MS = 700;

type Phase = "drop" | "look" | "talk" | "leave";

function phaseMs(phase: Phase, quip: string): number {
  if (phase === "drop") return DROP_MS;
  if (phase === "look") return LOOK_MS;
  if (phase === "talk") return Math.min(7000, Math.max(3600, 1400 + quip.length * 55));
  return LEAVE_MS;
}

export function DataSpider({ visit, onDone }: { visit: SpiderVisit; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [state, setPhase] = useState<Phase>("drop");
  const phase = visit.leaving ? "leave" : state;
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        phase === "leave"
          ? onDone()
          : setPhase(phase === "drop" ? "look" : phase === "look" ? "talk" : "leave"),
      phaseMs(phase, visit.quip),
    );
    return () => window.clearTimeout(timer);
  }, [phase, visit.quip, onDone]);
  const drop = visit.y - visit.top;
  const hidden = -(drop + SIZE);
  const bubbleRight = visit.x - SIZE / 2 - 12 - BUBBLE_WIDTH < 8;
  const hanging = phase === "look" || phase === "talk";

  return (
    <div
      aria-hidden
      data-seasonal="spider"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 overflow-hidden"
      style={{ top: visit.top }}
    >
      <motion.div
        className="absolute top-0 flex flex-col items-center"
        style={{ left: visit.x - SIZE / 2, width: SIZE }}
        initial={reduced ? { opacity: 0 } : { y: hidden }}
        animate={
          phase === "leave" ? (reduced ? { opacity: 0 } : { y: hidden }) : { y: 0, opacity: 1 }
        }
        transition={
          phase === "leave"
            ? { duration: (LEAVE_MS - 100) / 1000, ease: [0.55, 0, 0.75, 0.2] }
            : { type: "spring", stiffness: 80, damping: 11 }
        }
      >
        <div className="w-px bg-muted-foreground/70" style={{ height: drop }} />
        <motion.button
          type="button"
          tabIndex={-1}
          aria-label="Spinne verscheuchen"
          onClick={() => setPhase("leave")}
          className="pointer-events-auto cursor-pointer rounded-full outline-none"
          style={{ originY: 0 }}
          animate={hanging ? { rotate: [0, 4, -3, 2, 0] } : { rotate: 0 }}
          transition={{ duration: 2.4, ease: "easeInOut", repeat: hanging ? Infinity : 0 }}
        >
          <SpiderGlyph
            gaze={
              phase === "look"
                ? "scan"
                : phase === "talk"
                  ? bubbleRight
                    ? "right"
                    : "left"
                  : "ahead"
            }
          />
        </motion.button>
        <AnimatePresence>
          {phase === "talk" ? (
            <motion.p
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              style={{ top: drop + SIZE / 2, y: "-50%", maxWidth: BUBBLE_WIDTH }}
              className={cn(
                "absolute w-max rounded-xl border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-[0_14px_36px_-10px_oklch(0_0_0/24%),0_4px_10px_-4px_oklch(0_0_0/12%)]",
                bubbleRight
                  ? "left-[calc(100%+10px)] origin-left"
                  : "right-[calc(100%+10px)] origin-right",
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 size-2 -translate-y-1/2 rotate-45 border bg-popover",
                  bubbleRight
                    ? "-left-[5px] border-t-0 border-r-0"
                    : "-right-[5px] border-b-0 border-l-0",
                )}
              />
              {visit.quip}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

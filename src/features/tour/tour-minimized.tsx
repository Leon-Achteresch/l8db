import { ChevronRight, Maximize2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { TourMascot } from "@/features/tour/tour-mascot";
import { SPRING_PANEL } from "@/lib/ease";
import { advanceTour } from "@/lib/hooks/use-app-tour";
import { tourProgress } from "@/lib/tour/chapters";
import { useTourStore } from "@/lib/tour/store";

const ICON_BUTTON =
  "inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function TourMinimized() {
  const reduce = useReducedMotion();
  const chapterIndex = useTourStore((s) => s.chapterIndex);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const progress = tourProgress(chapterIndex, stepIndex);
  const restore = () => useTourStore.getState().setMinimized(false);

  return (
    <motion.div
      data-tour-ui="overview-minimized"
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : SPRING_PANEL}
      className="pointer-events-auto fixed right-4 bottom-4 z-[10000001] flex items-center gap-1 rounded-full bg-card/95 py-1 pr-1 pl-1.5 shadow-2xl ring-1 shadow-black/20 ring-border/60 backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={restore}
        aria-label="Tour einblenden"
        className="flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 transition-colors hover:bg-muted"
      >
        <span className="grid size-7 place-items-center overflow-hidden rounded-full bg-muted/70">
          <TourMascot size={22} />
        </span>
        <span
          data-tour-ui="progress"
          className="font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          {progress.current}/{progress.total}
        </span>
      </button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 rounded-full px-2.5"
        onClick={() => advanceTour()}
      >
        Weiter
        <ChevronRight className="size-3.5" />
      </Button>
      <button type="button" onClick={restore} aria-label="Tour einblenden" className={ICON_BUTTON}>
        <Maximize2 className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => useTourStore.getState().stop()}
        aria-label="Tour beenden"
        className={ICON_BUTTON}
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}

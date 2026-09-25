import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Sparkles,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TourChapterButton } from "@/features/tour/tour-chapter-button";
import { SPRING_LAYOUT } from "@/lib/ease";
import { advanceTour, jumpTourChapter, rewindTour } from "@/lib/hooks/use-app-tour";
import { TOUR_CHAPTERS, tourProgress } from "@/lib/tour/chapters";
import { overviewVerticalOffset } from "@/lib/tour/overview-position";
import { useTourStore } from "@/lib/tour/store";
import { cn } from "@/lib/utils";

export function TourOverview() {
  const overviewRef = useRef<HTMLElement>(null);
  const chapterIndex = useTourStore((s) => s.chapterIndex);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const completed = useTourStore((s) => s.completedChapterIds);
  const autoPilot = useTourStore((s) => s.autoPilot);
  const waiting = useTourStore((s) => s.waiting);
  const waitHint = useTourStore((s) => s.waitHint);
  const minimized = useTourStore((s) => s.minimized);
  const setAutoPilot = useTourStore((s) => s.setAutoPilot);
  const setMinimized = useTourStore((s) => s.setMinimized);
  const stop = useTourStore((s) => s.stop);
  const chapter = TOUR_CHAPTERS[chapterIndex];
  const step = chapter?.steps[stepIndex];
  const progress = tourProgress(chapterIndex, stepIndex);
  const reduceMotion = useReducedMotion();
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  useLayoutEffect(() => {
    if (minimized) return;
    let frame = 0;
    let timer = 0;
    const updatePosition = () => {
      const panel = overviewRef.current;
      if (!panel) return;
      const target = step?.target ? document.querySelector<HTMLElement>(step.target) : null;
      const popover = document.querySelector<HTMLElement>(".driver-popover.l8db-driver");
      const obstructions = [target, popover]
        .filter((element): element is HTMLElement => element !== null)
        .map((element) => element.getBoundingClientRect());
      setVerticalOffset((currentOffset) => {
        const nextOffset = overviewVerticalOffset({
          panel: panel.getBoundingClientRect(),
          currentOffset,
          obstructions,
        });
        return nextOffset === currentOffset ? currentOffset : nextOffset;
      });
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    if (overviewRef.current) observer.observe(overviewRef.current);
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
    timer = window.setTimeout(scheduleUpdate, 350);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [minimized, chapterIndex, stepIndex, step?.target]);

  if (minimized) {
    return (
      <div
        data-tour-ui="overview-minimized"
        className="pointer-events-auto fixed right-4 bottom-4 z-[10000001] flex items-center gap-1 rounded-full border border-border/80 bg-card/95 py-1 pr-1 pl-3 shadow-2xl shadow-black/20 backdrop-blur-xl"
      >
        <Sparkles className="size-3.5 text-primary" />
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Tour einblenden"
          className="rounded-full px-1.5 py-1 text-[11px] font-medium hover:bg-muted"
        >
          <span data-tour-ui="progress">
            Tour · {progress.current}/{progress.total}
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
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Tour einblenden"
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => stop()}
          aria-label="Tour beenden"
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <motion.aside
      ref={overviewRef}
      layout
      animate={{ y: verticalOffset }}
      transition={reduceMotion ? { duration: 0 } : { layout: SPRING_LAYOUT, y: SPRING_LAYOUT }}
      data-tour-ui="overview"
      className="pointer-events-auto fixed right-4 bottom-4 z-[10000001] flex max-h-[calc(100dvh-2rem)] w-[20rem] flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/92 shadow-2xl shadow-black/20 backdrop-blur-xl"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <Sparkles className="size-3.5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Tour</p>
          <p className="text-[11px] text-muted-foreground" data-tour-ui="progress">
            Schritt {progress.current} von {progress.total} · Kapitel {chapterIndex + 1}/
            {TOUR_CHAPTERS.length}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Tour minimieren"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => stop()}
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Tour beenden"
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto px-3 py-2.5">
        <p className="text-xs font-semibold" data-tour-ui="step-title">
          {step?.title}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-tour-ui="step-body">
          {step?.body}
        </p>
        {step?.action ? (
          <p
            className="mt-2 rounded-lg bg-primary/12 px-2.5 py-2 text-xs font-semibold text-foreground"
            data-tour-ui="step-action"
          >
            👉 {step.action}
          </p>
        ) : null}
        {waiting && waitHint ? (
          <p className="mt-1.5 text-[11px] font-medium text-primary" data-tour-ui="wait-hint">
            {waitHint}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setChaptersOpen((open) => !open)}
          aria-expanded={chaptersOpen}
          data-tour-ui="chapter-toggle"
          className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        >
          <span className="truncate">
            {chapterIndex + 1}. {chapter?.title} ({stepIndex + 1}/{chapter?.steps.length}) — alle
            Kapitel
          </span>
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform", chaptersOpen && "rotate-180")}
          />
        </button>
        {chaptersOpen ? (
          <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TOUR_CHAPTERS.map((item, index) => (
              <TourChapterButton
                key={item.id}
                index={index}
                title={item.title}
                summary={item.summary}
                active={index === chapterIndex}
                done={completed.includes(item.id)}
                onSelect={() => {
                  jumpTourChapter(index);
                  setChaptersOpen(false);
                }}
              />
            ))}
          </div>
        ) : null}
        <label className="mt-2.5 flex items-center justify-between gap-3 text-[11px]">
          <span className="text-muted-foreground">Autopilot: Die Tour klickt für dich</span>
          <Switch checked={autoPilot} onCheckedChange={setAutoPilot} aria-label="Autopilot" />
        </label>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 flex-1"
            onClick={() => rewindTour()}
          >
            <ChevronLeft className="size-3.5" />
            Zurück
          </Button>
          <Button type="button" size="sm" className="h-8 flex-1" onClick={() => advanceTour()}>
            {waiting ? "Überspringen" : "Weiter"}
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </motion.aside>
  );
}

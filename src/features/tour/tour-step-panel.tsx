import {
  ChevronLeft,
  ChevronRight,
  ListTree,
  Minus,
  MousePointerClick,
  Wand2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useState } from "react";
import { Button } from "@/components/ui/button";
import { TourAsk } from "@/features/tour/tour-ask";
import { TourChapterButton } from "@/features/tour/tour-chapter-button";
import { advanceTour, jumpTourChapter, rewindTour } from "@/lib/hooks/use-app-tour";
import type { TourLastAnswer, TourTurn } from "@/lib/tour/ask";
import { TOUR_CHAPTERS, tourProgress } from "@/lib/tour/chapters";
import { useTourStore } from "@/lib/tour/store";
import { cn } from "@/lib/utils";

interface Props {
  aiReady: boolean;
  history: RefObject<TourTurn[]>;
  lastAnswer: RefObject<TourLastAnswer | null>;
  onThinking: (thinking: boolean) => void;
}

const ICON_BUTTON =
  "inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function TourStepPanel({ aiReady, history, lastAnswer, onThinking }: Props) {
  const chapterIndex = useTourStore((s) => s.chapterIndex);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const completed = useTourStore((s) => s.completedChapterIds);
  const autoPilot = useTourStore((s) => s.autoPilot);
  const waiting = useTourStore((s) => s.waiting);
  const waitHint = useTourStore((s) => s.waitHint);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const chapter = TOUR_CHAPTERS[chapterIndex];
  const step = chapter?.steps[stepIndex];
  const progress = tourProgress(chapterIndex, stepIndex);

  return (
    <>
      <div className="flex items-center gap-1 pt-3 pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {chapterIndex + 1} · {chapter?.title}
        </span>
        <span
          data-tour-ui="progress"
          className="mr-1 font-mono text-[10px] text-muted-foreground tabular-nums"
        >
          {progress.current}/{progress.total}
        </span>
        <button
          type="button"
          onClick={() => useTourStore.getState().setMinimized(true)}
          aria-label="Tour minimieren"
          className={ICON_BUTTON}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => useTourStore.getState().stop()}
          aria-label="Tour beenden"
          className={ICON_BUTTON}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mx-4 mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={false}
          animate={{ width: `${(progress.current / progress.total) * 100}%` }}
          transition={{ type: "spring", stiffness: 260, damping: 32 }}
        />
      </div>
      <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step?.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="px-4 pt-3"
          >
            <h2 data-tour-ui="step-title" className="text-[15px] font-semibold tracking-tight">
              {step?.title}
            </h2>
            <p
              data-tour-ui="step-body"
              className="mt-1.5 text-[13px] leading-5 text-muted-foreground"
            >
              {step?.body}
            </p>
            {step?.action ? (
              <p
                data-tour-ui="step-action"
                className="mt-3 flex gap-2 rounded-lg bg-primary/10 px-3 py-2 text-[13px] leading-5 font-medium text-foreground"
              >
                <MousePointerClick className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {step.action}
              </p>
            ) : null}
            {waiting && waitHint ? (
              <p
                data-tour-ui="wait-hint"
                className="mt-2 flex items-center gap-2 text-xs font-medium text-primary"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                {waitHint}
              </p>
            ) : null}
          </motion.div>
        </AnimatePresence>
        {aiReady ? (
          <TourAsk
            key={step?.id}
            stepId={step?.id ?? ""}
            stepTitle={step?.title ?? null}
            history={history}
            lastAnswer={lastAnswer}
            onThinking={onThinking}
          />
        ) : null}
        {chaptersOpen ? (
          <div className="mx-2 mt-3 space-y-0.5 rounded-xl bg-muted/40 p-1">
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
      </div>
      <div className="flex items-center gap-1 px-3 pt-3 pb-3">
        <button
          type="button"
          onClick={() => setChaptersOpen((open) => !open)}
          aria-expanded={chaptersOpen}
          aria-label="Alle Kapitel"
          title="Alle Kapitel"
          data-tour-ui="chapter-toggle"
          className={cn(ICON_BUTTON, chaptersOpen && "bg-muted text-foreground")}
        >
          <ListTree className="size-3.5" />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={autoPilot}
          aria-label="Autopilot"
          title="Autopilot: Die Tour klickt für dich"
          onClick={() => useTourStore.getState().setAutoPilot(!autoPilot)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors",
            autoPilot
              ? "bg-primary/15 text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Wand2 className={cn("size-3.5", autoPilot && "text-primary")} />
          Auto
        </button>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 rounded-full px-3"
          disabled={progress.current === 1}
          onClick={() => rewindTour()}
        >
          <ChevronLeft className="size-3.5" />
          Zurück
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-full px-4"
          onClick={() => advanceTour()}
        >
          {waiting ? "Überspringen" : "Weiter"}
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </>
  );
}

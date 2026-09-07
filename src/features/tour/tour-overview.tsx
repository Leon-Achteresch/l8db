import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TourChapterButton } from "@/features/tour/tour-chapter-button";
import { SPRING_LAYOUT } from "@/lib/ease";
import { advanceTour, jumpTourChapter, rewindTour } from "@/lib/hooks/use-app-tour";
import { TOUR_CHAPTERS, tourProgress } from "@/lib/tour/chapters";
import { useTourStore } from "@/lib/tour/store";

export function TourOverview() {
  const chapterIndex = useTourStore((s) => s.chapterIndex);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const completed = useTourStore((s) => s.completedChapterIds);
  const autoPilot = useTourStore((s) => s.autoPilot);
  const waiting = useTourStore((s) => s.waiting);
  const waitHint = useTourStore((s) => s.waitHint);
  const setAutoPilot = useTourStore((s) => s.setAutoPilot);
  const stop = useTourStore((s) => s.stop);
  const chapter = TOUR_CHAPTERS[chapterIndex];
  const step = chapter?.steps[stepIndex];
  const progress = tourProgress(chapterIndex, stepIndex);

  return (
    <motion.aside
      layout
      transition={{ layout: SPRING_LAYOUT }}
      data-tour-ui="overview"
      className="pointer-events-auto fixed bottom-4 left-4 z-[10000001] flex w-[20.5rem] flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/92 shadow-2xl shadow-black/20 backdrop-blur-xl"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <Sparkles className="size-3.5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Tour</p>
          <p className="text-[11px] text-muted-foreground">
            Schritt {progress.current} von {progress.total}
          </p>
        </div>
        <button
          type="button"
          onClick={() => stop()}
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Tour schließen"
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div className="max-h-[min(46vh,22rem)] space-y-0.5 overflow-y-auto px-1.5 py-1.5">
        {TOUR_CHAPTERS.map((item, index) => (
          <TourChapterButton
            key={item.id}
            index={index}
            title={item.title}
            summary={item.summary}
            active={index === chapterIndex}
            done={completed.includes(item.id)}
            onSelect={() => jumpTourChapter(index)}
          />
        ))}
      </div>
      <div className="border-t px-3 py-2.5">
        <p className="text-xs font-semibold">{step?.title}</p>
        {waiting && waitHint ? (
          <p className="mt-1 text-[11px] text-primary">{waitHint}</p>
        ) : (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {chapter?.steps.length
              ? `Kapitel ${chapterIndex + 1}: ${stepIndex + 1}/${chapter.steps.length}`
              : null}
          </p>
        )}
        <label className="mt-2.5 flex items-center justify-between gap-3 text-[11px]">
          <span className="text-muted-foreground">Autopilot klickt und wechselt Seiten</span>
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

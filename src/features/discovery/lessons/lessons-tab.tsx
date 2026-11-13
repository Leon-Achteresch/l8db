import { Check, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { LESSONS } from "@/lib/discovery/lessons/lessons";
import { lessonAvailable } from "@/lib/discovery/lessons/progress";
import { endLesson, resumeLesson, startLesson } from "@/lib/discovery/lessons/runtime";
import { useLessonsStore } from "@/lib/discovery/lessons/store";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useCapabilities } from "@/lib/providers";
import { cn } from "@/lib/utils";

export function LessonsTab() {
  const capabilities = useCapabilities("sqlite");
  const progress = useLessonsStore((state) => state.progress);
  const active = useLessonsStore((state) => state.active);
  const [starting, setStarting] = useState<string | null>(null);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.lessons");
  const lessons = useMemo(
    () => LESSONS.filter((lesson) => lessonAvailable(lesson, capabilities)),
    [capabilities],
  );

  const start = (id: string) => {
    setStarting(id);
    void startLesson(id).finally(() => setStarting(null));
  };

  return (
    <div ref={ref} className="space-y-2" data-feature="discover.lessons">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        Lektionen
        {isNew && <NewBadge />}
      </h2>
      {lessons.map((lesson) => {
        const state = progress[lesson.id];
        const current = active?.lessonId === lesson.id;
        const step = Math.min(state?.step ?? 0, lesson.steps.length);
        return (
          <div
            key={lesson.id}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 px-4 py-3",
              current && "bg-primary/10",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {lesson.title}
                {state?.done && <Check className="size-4 text-primary" aria-label="Erledigt" />}
              </p>
              <p className="truncate text-xs text-muted-foreground">{lesson.summary}</p>
            </div>
            <div className="flex gap-1" title={`${step} von ${lesson.steps.length}`}>
              {lesson.steps.map((entry, index) => (
                <span
                  key={entry.id}
                  className={cn(
                    "size-1.5 rounded-full bg-muted-foreground/30",
                    (state?.done || index < step) && "bg-primary",
                  )}
                />
              ))}
            </div>
            {current ? (
              <div className="flex gap-1">
                {active.paused && !state?.done && (
                  <Button size="sm" className="cursor-pointer" onClick={() => void resumeLesson()}>
                    Weiter
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => void endLesson()}
                >
                  Lektion beenden
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="cursor-pointer"
                disabled={starting !== null}
                onClick={() => start(lesson.id)}
              >
                <Play />
                {state?.done ? "Wiederholen" : "Lektion starten"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

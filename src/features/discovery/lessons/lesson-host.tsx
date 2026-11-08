import { useEffect } from "react";
import { handleLessonSignal } from "@/lib/discovery/lessons/runtime";
import { useLessonsStore } from "@/lib/discovery/lessons/store";
import { onFeatureEvent, onFeatureUsed } from "@/lib/discovery/usage";

export function LessonHost() {
  const lessonId = useLessonsStore((state) => state.active?.lessonId ?? null);

  useEffect(() => {
    if (!lessonId) return;
    const stopUsed = onFeatureUsed((feature) => handleLessonSignal({ feature }));
    const stopEvents = onFeatureEvent((event) => handleLessonSignal({ event }));
    return () => {
      stopUsed();
      stopEvents();
    };
  }, [lessonId]);

  return null;
}

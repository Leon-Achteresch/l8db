import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";
import { onDiscoveryReset } from "../usage";
import { lessonById } from "./lessons";
import { type LessonProgress, pruneLessonProgress } from "./progress";

export const LESSONS_STORAGE_KEY = "l8db.discovery.lessons";

export interface ActiveLesson {
  lessonId: string;
  connectionId: string | null;
  previousId: string | null;
  paused: boolean;
}

interface LessonsState {
  progress: Record<string, LessonProgress>;
  active: ActiveLesson | null;
  setProgress: (id: string, progress: LessonProgress) => void;
  setActive: (active: ActiveLesson | null) => void;
  reset: () => void;
}

export const useLessonsStore = create<LessonsState>()(
  persist(
    (set) => ({
      progress: {},
      active: null,
      setProgress: (id, progress) =>
        set((state) => ({ progress: { ...state.progress, [id]: progress } })),
      setActive: (active) => set({ active }),
      reset: () => set({ progress: {}, active: null }),
    }),
    {
      name: LESSONS_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ progress: state.progress }),
      merge: (persisted, current) => ({
        ...current,
        progress: pruneLessonProgress(
          (persisted as { progress?: unknown } | undefined)?.progress,
          (id) => lessonById(id) !== undefined,
        ),
      }),
    },
  ),
);

syncAcrossWindows(LESSONS_STORAGE_KEY, () => void useLessonsStore.persist.rehydrate());
onDiscoveryReset(() => useLessonsStore.setState({ progress: {} }));

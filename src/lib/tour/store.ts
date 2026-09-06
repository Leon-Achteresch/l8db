import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TOUR_CHAPTERS } from "@/lib/tour/chapters";
import { useSettingsStore } from "@/lib/settings";

interface TourState {
  active: boolean;
  chapterIndex: number;
  stepIndex: number;
  completedChapterIds: string[];
  autoPilot: boolean;
  waiting: boolean;
  waitHint: string | null;
  waitBaseline: number;
  clickDone: boolean;
  startFromBeginning: () => void;
  resumeOrStart: () => void;
  stop: (finished: boolean) => void;
  setAutoPilot: (value: boolean) => void;
  setPosition: (chapterIndex: number, stepIndex: number) => void;
  markChapterDone: (id: string) => void;
  setWaiting: (waiting: boolean, hint: string | null, baseline?: number) => void;
  setClickDone: (value: boolean) => void;
}

export const useTourStore = create<TourState>()(
  persist(
    (set) => ({
      active: false,
      chapterIndex: 0,
      stepIndex: 0,
      completedChapterIds: [],
      autoPilot: false,
      waiting: false,
      waitHint: null,
      waitBaseline: 0,
      clickDone: false,
      startFromBeginning: () => {
        useSettingsStore.getState().setTourFinished(false);
        set({
          active: true,
          chapterIndex: 0,
          stepIndex: 0,
          completedChapterIds: [],
          waiting: false,
          waitHint: null,
          waitBaseline: 0,
          clickDone: false,
        });
      },
      resumeOrStart: () => {
        useSettingsStore.getState().setTourFinished(false);
        set({ active: true, waiting: false, waitHint: null, clickDone: false });
      },
      stop: (finished) => {
        if (finished) useSettingsStore.getState().setTourFinished(true);
        set({ active: false, waiting: false, waitHint: null, clickDone: false });
      },
      setAutoPilot: (autoPilot) => set({ autoPilot }),
      setPosition: (chapterIndex, stepIndex) =>
        set({
          chapterIndex,
          stepIndex,
          waiting: false,
          waitHint: null,
          clickDone: false,
        }),
      markChapterDone: (id) =>
        set((state) =>
          state.completedChapterIds.includes(id)
            ? state
            : { completedChapterIds: [...state.completedChapterIds, id] },
        ),
      setWaiting: (waiting, waitHint, waitBaseline) =>
        set((state) => ({
          waiting,
          waitHint,
          waitBaseline: waitBaseline ?? state.waitBaseline,
        })),
      setClickDone: (clickDone) => set({ clickDone }),
    }),
    {
      name: "l8db.tour",
      partialize: (state) => ({
        active: state.active,
        chapterIndex: state.chapterIndex,
        stepIndex: state.stepIndex,
        completedChapterIds: state.completedChapterIds,
        autoPilot: state.autoPilot,
      }),
    },
  ),
);

export function currentTour() {
  const { chapterIndex, stepIndex } = useTourStore.getState();
  const chapter = TOUR_CHAPTERS[chapterIndex];
  const step = chapter?.steps[stepIndex];
  return { chapter, step, chapterIndex, stepIndex };
}

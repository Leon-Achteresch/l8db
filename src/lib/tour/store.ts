import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { useSettingsStore } from "@/lib/settings";
import { syncAcrossWindows } from "@/lib/window-sync";

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
  runId: number;
  minimized: boolean;
  offerOpen: boolean;
  offerDismissed: boolean;
  detour: string | null;
  detourFrom: string | null;
  startFromBeginning: () => void;
  resumeOrStart: () => void;
  stop: () => void;
  setAutoPilot: (value: boolean) => void;
  setPosition: (chapterIndex: number, stepIndex: number) => void;
  markChapterDone: (id: string) => void;
  setWaiting: (waiting: boolean, hint: string | null, baseline?: number) => void;
  setClickDone: (value: boolean) => void;
  setMinimized: (value: boolean) => void;
  openOffer: () => void;
  dismissOffer: () => void;
  showFeature: (id: string) => void;
  endDetour: () => void;
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
      runId: 0,
      minimized: false,
      offerOpen: false,
      offerDismissed: false,
      detour: null,
      detourFrom: null,
      startFromBeginning: () => {
        useSettingsStore.getState().setTourFinished(false);
        set((state) => ({
          active: true,
          chapterIndex: 0,
          stepIndex: 0,
          completedChapterIds: [],
          waiting: false,
          waitHint: null,
          waitBaseline: 0,
          clickDone: false,
          minimized: false,
          offerOpen: false,
          detour: null,
          detourFrom: null,
          runId: state.runId + 1,
        }));
      },
      resumeOrStart: () => {
        useSettingsStore.getState().setTourFinished(false);
        set((state) => ({
          active: true,
          waiting: false,
          waitHint: null,
          clickDone: false,
          minimized: false,
          offerOpen: false,
          detour: null,
          detourFrom: null,
          runId: state.runId + 1,
        }));
      },
      stop: () => {
        useSettingsStore.getState().setTourFinished(true);
        set({
          active: false,
          waiting: false,
          waitHint: null,
          clickDone: false,
          minimized: false,
          offerOpen: false,
          detour: null,
          detourFrom: null,
        });
      },
      setAutoPilot: (autoPilot) => set({ autoPilot }),
      setPosition: (chapterIndex, stepIndex) =>
        set((state) => ({
          chapterIndex,
          stepIndex,
          waiting: false,
          waitHint: null,
          clickDone: false,
          detour: null,
          runId: state.runId + 1,
        })),
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
      setMinimized: (minimized) =>
        set((state) => ({
          minimized,
          runId: minimized === state.minimized ? state.runId : state.runId + 1,
        })),
      openOffer: () => set({ offerOpen: true }),
      dismissOffer: () => set({ offerOpen: false, offerDismissed: true }),
      showFeature: (detour) =>
        set((state) => ({
          detour,
          detourFrom: state.detourFrom ?? `${window.location.pathname}${window.location.search}`,
          minimized: false,
          waiting: false,
          waitHint: null,
          runId: state.runId + 1,
        })),
      endDetour: () => set((state) => ({ detour: null, runId: state.runId + 1 })),
    }),
    {
      name: "l8db.tour",
      storage: createSafeJsonStorage(),
      partialize: (state) => ({
        active: state.active,
        chapterIndex: state.chapterIndex,
        stepIndex: state.stepIndex,
        completedChapterIds: state.completedChapterIds,
        autoPilot: state.autoPilot,
        offerDismissed: state.offerDismissed,
      }),
    },
  ),
);

syncAcrossWindows("l8db.tour", (value) => {
  try {
    const saved = (JSON.parse(value ?? "null") as { state?: Partial<TourState> } | null)?.state;
    if (!saved) return;
    useTourStore.setState((state) => ({
      completedChapterIds: Array.isArray(saved.completedChapterIds)
        ? saved.completedChapterIds
        : state.completedChapterIds,
      offerDismissed: saved.offerDismissed === true || state.offerDismissed,
    }));
  } catch {}
});

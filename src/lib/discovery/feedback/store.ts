import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { NEW_FEATURES, type NewFeatureId } from "@/lib/new-features";
import { syncAcrossWindows } from "@/lib/window-sync";
import { compareVersions, featureById } from "../catalog";
import { onDiscoveryReset } from "../usage";

export const FEEDBACK_STORAGE_KEY = "l8db.discovery.feedback";
export const FEEDBACK_AFTER_USES = 3;
export const FEEDBACK_MIN_VERSION = "0.17.0";
export const MAX_FEEDBACK_ASKED = 512;
export const MAX_FEEDBACK_ANSWERS = 50;
export const MAX_FEEDBACK_TEXT = 500;

export type FeedbackVote = "up" | "down";

export interface FeedbackAnswer {
  featureId: string;
  vote: FeedbackVote;
  text: string;
  at: number;
}

interface FeedbackState {
  asked: string[];
  answers: FeedbackAnswer[];
  active: string | null;
  markAsked: (featureId: string) => void;
  answer: (featureId: string, vote: FeedbackVote, text?: string, now?: number) => void;
  remove: (at: number) => void;
  dismiss: () => void;
  reset: () => void;
}

export function isNewFeature(id: string): boolean {
  const versions = [
    Object.hasOwn(NEW_FEATURES, id) ? NEW_FEATURES[id as NewFeatureId] : undefined,
    featureById(id)?.since,
  ];
  return versions.some(
    (version) => version !== undefined && compareVersions(version, FEEDBACK_MIN_VERSION) >= 0,
  );
}

export function shouldAskFeedback(id: string, count: number, asked: readonly string[]): boolean {
  return count >= FEEDBACK_AFTER_USES && !asked.includes(id) && isNewFeature(id);
}

function capped<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(-max) : list;
}

function pruneAnswers(value: unknown): FeedbackAnswer[] {
  if (!Array.isArray(value)) return [];
  const result: FeedbackAnswer[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { featureId, vote, text, at } = raw as Partial<FeedbackAnswer>;
    if (typeof featureId !== "string" || (vote !== "up" && vote !== "down")) continue;
    if (!Number.isFinite(at)) continue;
    result.push({
      featureId,
      vote,
      text: typeof text === "string" ? text.slice(0, MAX_FEEDBACK_TEXT) : "",
      at: at as number,
    });
  }
  return capped(result, MAX_FEEDBACK_ANSWERS);
}

export const useFeedbackStore = create<FeedbackState>()(
  persist(
    (set) => ({
      asked: [],
      answers: [],
      active: null,
      markAsked: (featureId) =>
        set((state) => ({
          active: featureId,
          asked: state.asked.includes(featureId)
            ? state.asked
            : capped([...state.asked, featureId], MAX_FEEDBACK_ASKED),
        })),
      answer: (featureId, vote, text = "", now = Date.now()) =>
        set((state) => ({
          active: state.active === featureId ? null : state.active,
          answers: capped(
            [
              ...state.answers,
              { featureId, vote, text: text.trim().slice(0, MAX_FEEDBACK_TEXT), at: now },
            ],
            MAX_FEEDBACK_ANSWERS,
          ),
        })),
      remove: (at) => set((state) => ({ answers: state.answers.filter((item) => item.at !== at) })),
      dismiss: () => set({ active: null }),
      reset: () => set({ asked: [], answers: [], active: null }),
    }),
    {
      name: FEEDBACK_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ asked: state.asked, answers: state.answers }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as { asked?: unknown; answers?: unknown };
        const asked = Array.isArray(saved.asked)
          ? capped(
              saved.asked.filter((id): id is string => typeof id === "string"),
              MAX_FEEDBACK_ASKED,
            )
          : [];
        return { ...current, asked, answers: pruneAnswers(saved.answers) };
      },
    },
  ),
);

syncAcrossWindows(FEEDBACK_STORAGE_KEY, () => void useFeedbackStore.persist.rehydrate());
onDiscoveryReset(() => useFeedbackStore.getState().reset());

export function feedbackIssueText(answer: FeedbackAnswer): string {
  const title = featureById(answer.featureId)?.title ?? answer.featureId;
  const vote = answer.vote === "up" ? "👍" : "👎";
  return `Erstelle dafür ein Issue. Feedback zu „${title}“ (${answer.featureId}): ${vote}${answer.text ? ` – ${answer.text}` : ""}`;
}

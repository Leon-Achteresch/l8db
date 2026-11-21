import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import type { AiProfile } from "@/lib/db/ai";
import { syncAcrossWindows } from "@/lib/window-sync";

type ConsentProfile = Pick<AiProfile, "provider" | "endpoint">;

interface AiAccessState {
  enabled: boolean;
  consent: string[];
  pending: ConsentProfile | null;
  setEnabled: (enabled: boolean) => void;
  grant: (key: string) => void;
  revoke: (key: string) => void;
}

const KEY = "l8db.ai.access";
const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "compatible"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
const AI_FEATURE = /(^|\.)(ai|ask-ai)(\.|-|$)/;
const waiting: ((granted: boolean) => void)[] = [];

export const useAiAccess = create<AiAccessState>()(
  persist(
    (set) => ({
      enabled: true,
      consent: [],
      pending: null,
      setEnabled: (enabled) => set({ enabled }),
      grant: (key) =>
        set((state) =>
          state.consent.includes(key) ? state : { consent: [...state.consent, key] },
        ),
      revoke: (key) =>
        set((state) => ({ consent: state.consent.filter((entry) => entry !== key) })),
    }),
    {
      name: KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ enabled: state.enabled, consent: state.consent }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AiAccessState>;
        return {
          ...current,
          enabled: typeof saved.enabled === "boolean" ? saved.enabled : current.enabled,
          consent: Array.isArray(saved.consent)
            ? saved.consent.filter((entry): entry is string => typeof entry === "string")
            : current.consent,
        };
      },
    },
  ),
);

syncAcrossWindows(KEY, () => void useAiAccess.persist.rehydrate());

useAiAccess.subscribe((state, previous) => {
  if (previous.enabled && !state.enabled && state.pending) settle(false);
});

export const useAiEnabled = () => useAiAccess((state) => state.enabled);

export const aiEnabled = () => useAiAccess.getState().enabled;

export const isAiFeatureId = (id: string) => AI_FEATURE.test(id);

export function isLocalAiProfile(profile: ConsentProfile): boolean {
  if (!LOCAL_PROVIDERS.has(profile.provider)) return false;
  const endpoint = profile.endpoint.trim();
  if (!endpoint) return profile.provider !== "compatible";
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function aiConsentKey(profile: ConsentProfile): string {
  const endpoint = profile.endpoint.trim();
  if (!endpoint) return profile.provider;
  try {
    return `${profile.provider}@${new URL(endpoint).host.toLowerCase()}`;
  } catch {
    return `${profile.provider}@${endpoint}`;
  }
}

export function aiConsentGiven(profile: ConsentProfile): boolean {
  return (
    isLocalAiProfile(profile) || useAiAccess.getState().consent.includes(aiConsentKey(profile))
  );
}

export function aiBlockReason(profile: ConsentProfile): string | null {
  if (!aiEnabled()) return "KI ist ausgeschaltet.";
  if (!aiConsentGiven(profile)) return "KI-Anbieter nicht freigegeben.";
  return null;
}

export function assertAiAllowed(profile: ConsentProfile, consent = true): void {
  const reason = consent ? aiBlockReason(profile) : aiEnabled() ? null : "KI ist ausgeschaltet.";
  if (reason) throw new Error(reason);
}

function settle(answer: boolean) {
  const pending = useAiAccess.getState().pending;
  const granted = answer && pending !== null && aiEnabled();
  if (granted) useAiAccess.getState().grant(aiConsentKey(pending));
  useAiAccess.setState({ pending: null });
  for (const resolve of waiting.splice(0)) resolve(granted);
}

export const answerAiConsent = (granted: boolean) => settle(granted);

export function requestAiConsent(profile: ConsentProfile): Promise<boolean> {
  if (!aiEnabled()) return Promise.resolve(false);
  if (aiConsentGiven(profile)) return Promise.resolve(true);
  const pending = useAiAccess.getState().pending;
  if (pending && aiConsentKey(pending) !== aiConsentKey(profile)) settle(false);
  useAiAccess.setState({ pending: { provider: profile.provider, endpoint: profile.endpoint } });
  return new Promise((resolve) => waiting.push(resolve));
}

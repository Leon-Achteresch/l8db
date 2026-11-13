import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import type { DatabaseKind } from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { syncAcrossWindows } from "@/lib/window-sync";
import { type FeatureEvent, onFeatureEvent } from "../events";
import { onDiscoveryReset, useFeatureUsageStore } from "../usage";
import { useWaitTipStore } from "./current";
import { MAX_SEEN_TIPS, pickWaitTip, type WaitTipFilter, waitTipsFor } from "./pick";

export const WAIT_TIP_DELAY_MS = 2_000;
export const WAIT_TIPS_STORAGE_KEY = "l8db.discovery.wait-tips";
export const MAX_RUNNING = 32;

interface SeenState {
  seen: string[];
  setSeen: (seen: string[]) => void;
  reset: () => void;
}

export const useWaitTipsSeenStore = create<SeenState>()(
  persist(
    (set) => ({
      seen: [],
      setSeen: (seen) => set({ seen }),
      reset: () => set({ seen: [] }),
    }),
    {
      name: WAIT_TIPS_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ seen: state.seen }),
      merge: (persisted, current) => {
        const raw = (persisted as { seen?: unknown } | undefined)?.seen;
        const seen = Array.isArray(raw)
          ? raw.filter((id): id is string => typeof id === "string").slice(-MAX_SEEN_TIPS)
          : [];
        return { ...current, seen };
      },
    },
  ),
);

syncAcrossWindows(WAIT_TIPS_STORAGE_KEY, () => void useWaitTipsSeenStore.persist.rehydrate());
onDiscoveryReset(() => useWaitTipsSeenStore.getState().reset());

export function waitTipsEnabled(): boolean {
  const discovery = useSettingsStore.getState().discovery;
  return discovery?.enabled !== false && discovery?.channels?.waitTips !== false;
}

function defaultFilter(family: string | null): WaitTipFilter {
  return {
    family,
    capabilities: family ? capabilitiesFor(family as DatabaseKind) : null,
    easyMode: useSettingsStore.getState().easyMode === true,
    usage: useFeatureUsageStore.getState().usage,
  };
}

export function showNextWaitTip(family: string | null, resolve = defaultFilter): boolean {
  const { seen } = useWaitTipsSeenStore.getState();
  const { tip, seen: next } = pickWaitTip(waitTipsFor(resolve(family)), seen);
  if (!tip) return false;
  useWaitTipStore.setState({
    tip: { id: tip.id, text: tip.text, hotkey: tip.hotkey },
    commit: () => useWaitTipsSeenStore.getState().setSeen(next),
  });
  return true;
}

export function installWaitTips({
  delayMs = WAIT_TIP_DELAY_MS,
  resolve = defaultFilter,
  enabled = waitTipsEnabled,
}: {
  delayMs?: number;
  resolve?: (family: string | null) => WaitTipFilter;
  enabled?: () => boolean;
} = {}): () => void {
  const running = new Map<string, ReturnType<typeof setTimeout> | null>();
  const hide = () => {
    const current = useWaitTipStore.getState();
    if (current.tip || current.commit) useWaitTipStore.setState({ tip: null, commit: null });
  };
  const onEvent = (event: FeatureEvent) => {
    const id = typeof event.data.id === "string" ? event.data.id : null;
    if (!id) return;
    if (event.name === "query.started") {
      if (!enabled()) return;
      if (running.size >= MAX_RUNNING) {
        const [oldest, pending] = running.entries().next().value as [string, unknown];
        if (pending) clearTimeout(pending as ReturnType<typeof setTimeout>);
        running.delete(oldest);
      }
      const family = typeof event.data.family === "string" ? event.data.family : null;
      const timer = setTimeout(() => {
        running.set(id, null);
        if (!useWaitTipStore.getState().tip && enabled()) showNextWaitTip(family, resolve);
      }, delayMs);
      running.set(id, timer);
    } else if (event.name === "query.finished") {
      const timer = running.get(id);
      if (timer) clearTimeout(timer);
      running.delete(id);
      if (running.size === 0) hide();
    }
  };
  const stop = onFeatureEvent(onEvent);
  return () => {
    stop();
    for (const timer of running.values()) if (timer) clearTimeout(timer);
    running.clear();
    hide();
  };
}

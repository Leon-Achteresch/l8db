import { useSettingsStore } from "@/lib/settings";
import { recordCount, recordView, recordViewActivity, usageTrackingEnabled } from "@/lib/telemetry";
import {
  normalizeUsageView,
  USAGE_RESET_KEY,
  USAGE_STORAGE_PREFIX,
  usageStatisticsStore,
} from "@/lib/usage-statistics";
import { syncAcrossWindows } from "@/lib/window-sync";

export const USAGE_IDLE_MS = 60000;
const ACTIVITY_CHECKPOINT_MS = 5000;

interface TrackerOptions {
  now?: () => number;
  enabled?: () => boolean;
  open?: (route: string, previous: string | null) => void;
  active?: (view: string, ms: number) => void;
}

export function createUsageTracker({
  now = performance.now.bind(performance),
  enabled = usageTrackingEnabled,
  open = recordView,
  active = recordViewActivity,
}: TrackerOptions = {}) {
  let view: string | null = null;
  let previous: string | null = null;
  let started: number | null = null;
  let lastActivity = now();
  let foreground = true;
  let disposed = false;
  const checkpoint = () => {
    if (started !== null && view && enabled()) {
      const ms = Math.max(0, Math.min(now(), lastActivity + USAGE_IDLE_MS) - started);
      if (ms > 0) active(view, ms);
    }
    started = null;
  };
  const begin = () => {
    if (!view || !enabled() || disposed) return;
    if (previous !== view) {
      open(`/${view.replace(".", "/")}`, previous);
      previous = view;
    }
    if (foreground && started === null) {
      started = now();
      lastActivity = now();
    }
  };
  return {
    view: (route: string) => {
      if (disposed) return;
      const next = normalizeUsageView(route);
      if (view === next) {
        begin();
        return;
      }
      checkpoint();
      view = next;
      begin();
    },
    activity: () => {
      if (disposed || !foreground || !enabled()) return;
      if (started !== null && now() - started >= ACTIVITY_CHECKPOINT_MS) checkpoint();
      lastActivity = now();
      begin();
    },
    suspend: () => {
      checkpoint();
      foreground = false;
    },
    resume: () => {
      foreground = true;
      begin();
    },
    reset: () => {
      started = null;
      previous = null;
      begin();
    },
    resetActivity: () => {
      started = foreground && enabled() ? now() : null;
      lastActivity = now();
    },
    dispose: () => {
      checkpoint();
      disposed = true;
    },
  };
}

syncAcrossWindows(USAGE_RESET_KEY, () => usageStatisticsStore.refresh());

export function initUsageTracking() {
  const tracker = createUsageTracker();
  let sessionRecorded = false;
  const session = () => {
    if (sessionRecorded || !useSettingsStore.getState().usageMetrics) return;
    sessionRecorded = true;
    recordCount("session.start", {});
  };
  session();
  const unsubscribeReset = usageStatisticsStore.subscribeReset(tracker.resetActivity);
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (
      state.localUsageStats !== previous.localUsageStats ||
      state.usageMetrics !== previous.usageMetrics
    ) {
      tracker.reset();
      usageStatisticsStore.flush();
      session();
    }
  });
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      tracker.suspend();
      usageStatisticsStore.flush();
    } else if (document.hasFocus()) tracker.resume();
  };
  const onBlur = () => {
    tracker.suspend();
    usageStatisticsStore.flush();
  };
  const onFocus = () => {
    if (document.visibilityState !== "hidden") tracker.resume();
  };
  const onPageHide = () => {
    tracker.suspend();
    usageStatisticsStore.flush();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(USAGE_STORAGE_PREFIX))
      usageStatisticsStore.refresh();
  };
  if (document.visibilityState === "hidden" || !document.hasFocus()) tracker.suspend();
  const activityEvents = ["pointerdown", "keydown", "wheel"] as const;
  for (const event of activityEvents)
    document.addEventListener(event, tracker.activity, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("storage", onStorage);
  return {
    view: tracker.view,
    dispose: () => {
      unsubscribe();
      unsubscribeReset();
      for (const event of activityEvents) document.removeEventListener(event, tracker.activity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("storage", onStorage);
      tracker.dispose();
      usageStatisticsStore.flush();
    },
  };
}

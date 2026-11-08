import { lazy, Suspense, useEffect } from "react";
import { CHECK_INTERVAL } from "@/lib/blog-suggestions/quiet";
import { FEATURE_CATALOG, featureAvailable } from "@/lib/discovery/catalog";
import { requestSurface } from "@/lib/discovery/coordinator";
import { decideSpotlight } from "@/lib/discovery/spotlight/model";
import { SPOTLIGHT_SURFACE_ID, useSpotlightStore } from "@/lib/discovery/spotlight/store";
import { useSettingsStore } from "@/lib/settings";
import { getAppVersion } from "@/lib/updater";

const SpotlightDialog = lazy(() =>
  import("@/features/discovery/spotlight/spotlight-dialog").then(({ SpotlightDialog }) => ({
    default: SpotlightDialog,
  })),
);

export function SpotlightHost() {
  const open = useSpotlightStore((state) => state.open);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const store = useSpotlightStore;
    const lastActive = store.getState().lastActive;
    store.getState().touch();
    const touch = () => store.getState().touch();
    window.addEventListener("focus", touch);

    void getAppVersion().then((current) => {
      if (!alive) return;
      const decide = () => {
        const settings = useSettingsStore.getState();
        const state = store.getState();
        return decideSpotlight({
          current,
          seen: state.seenVersion,
          lastActive,
          now: Date.now(),
          onboardingDone: settings.onboardingDone,
          entries: FEATURE_CATALOG.filter((entry) =>
            featureAvailable(entry, { easyMode: settings.easyMode }),
          ),
          dev: import.meta.env.DEV,
          sessionShown: state.sessionShown,
        });
      };
      const attempt = () => {
        const decision = decide();
        if (decision.action === "remember") store.getState().markSeen(decision.version);
        if (decision.action !== "show") {
          clearInterval(timer);
          return;
        }
        if (
          !requestSurface({
            channel: decision.content.kind,
            id: SPOTLIGHT_SURFACE_ID,
            priority: 90,
          })
        )
          return;
        clearInterval(timer);
        store.getState().markSeen(decision.version);
        store.getState().show(decision.content, false);
      };
      if (decide().action === "show") timer = setInterval(attempt, CHECK_INTERVAL);
      attempt();
    });

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", touch);
    };
  }, []);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SpotlightDialog content={open} />
    </Suspense>
  );
}

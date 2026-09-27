import { lazy, Suspense, useEffect } from "react";
import { useSettingsStore } from "@/lib/settings";
import { useTourStore } from "@/lib/tour/store";

const AppTour = lazy(() =>
  import("@/features/tour/app-tour").then(({ AppTour }) => ({ default: AppTour })),
);

function tryOffer() {
  if (!useSettingsStore.persist.hasHydrated()) return;
  if (!useTourStore.persist.hasHydrated()) return;
  const settings = useSettingsStore.getState();
  if (settings.tourFinished || !settings.onboardingDone) return;
  const tour = useTourStore.getState();
  if (tour.active || tour.offerOpen || tour.offerDismissed) return;
  tour.openOffer();
}

export function AppTourHost() {
  const active = useTourStore((state) => state.active);
  const offerOpen = useTourStore((state) => state.offerOpen);
  const onboardingDone = useSettingsStore((state) => state.onboardingDone);

  useEffect(() => {
    if (onboardingDone) tryOffer();
  }, [onboardingDone]);

  useEffect(() => {
    const offSettings = useSettingsStore.persist.onFinishHydration(tryOffer);
    const offTour = useTourStore.persist.onFinishHydration(tryOffer);
    tryOffer();
    return () => {
      offSettings();
      offTour();
    };
  }, []);

  if (!active && !offerOpen) return null;
  return (
    <Suspense fallback={null}>
      <AppTour />
    </Suspense>
  );
}

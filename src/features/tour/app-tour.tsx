import "driver.js/dist/driver.css";
import { useEffect } from "react";
import { TourOffer } from "@/features/tour/tour-offer";
import { TourOverview } from "@/features/tour/tour-overview";
import { useAppTour } from "@/lib/hooks/use-app-tour";
import { useSettingsStore } from "@/lib/settings";
import { useTourStore } from "@/lib/tour/store";

function tryOffer() {
  if (!useSettingsStore.persist.hasHydrated()) return;
  if (!useTourStore.persist.hasHydrated()) return;
  const settings = useSettingsStore.getState();
  if (settings.tourFinished || !settings.onboardingDone) return;
  const tour = useTourStore.getState();
  if (tour.active || tour.offerOpen || tour.offerDismissed) return;
  tour.openOffer();
}

export function AppTour() {
  const active = useTourStore((s) => s.active);
  const offerOpen = useTourStore((s) => s.offerOpen);
  const onboardingDone = useSettingsStore((s) => s.onboardingDone);
  useAppTour();

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

  if (active) return <TourOverview />;
  if (offerOpen) return <TourOffer />;
  return null;
}

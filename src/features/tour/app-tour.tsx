import "driver.js/dist/driver.css";
import { useEffect } from "react";
import { TourOverview } from "@/features/tour/tour-overview";
import { useAppTour } from "@/lib/hooks/use-app-tour";
import { useSettingsStore } from "@/lib/settings";
import { useTourStore } from "@/lib/tour/store";

function tryAutostart() {
  if (!useSettingsStore.persist.hasHydrated()) return;
  if (!useTourStore.persist.hasHydrated()) return;
  if (useSettingsStore.getState().tourFinished) return;
  if (useTourStore.getState().active) return;
  useTourStore.getState().startFromBeginning();
}

export function AppTour() {
  const active = useTourStore((s) => s.active);
  useAppTour();

  useEffect(() => {
    const offSettings = useSettingsStore.persist.onFinishHydration(tryAutostart);
    const offTour = useTourStore.persist.onFinishHydration(tryAutostart);
    tryAutostart();
    return () => {
      offSettings();
      offTour();
    };
  }, []);

  if (!active) return null;
  return <TourOverview />;
}

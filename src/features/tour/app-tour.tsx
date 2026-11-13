import { TourMinimized } from "@/features/tour/tour-minimized";
import { TourOffer } from "@/features/tour/tour-offer";
import { TourStage } from "@/features/tour/tour-stage";
import { useAppTour } from "@/lib/hooks/use-app-tour";
import { useTourStore } from "@/lib/tour/store";

export function AppTour() {
  const active = useTourStore((s) => s.active);
  const offerOpen = useTourStore((s) => s.offerOpen);
  const minimized = useTourStore((s) => s.minimized);
  useAppTour();

  if (active) return minimized ? <TourMinimized /> : <TourStage />;
  if (offerOpen) return <TourOffer />;
  return null;
}

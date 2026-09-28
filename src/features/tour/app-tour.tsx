import { TourOffer } from "@/features/tour/tour-offer";
import { TourOverview } from "@/features/tour/tour-overview";
import { useAppTour } from "@/lib/hooks/use-app-tour";
import { useTourStore } from "@/lib/tour/store";

export function AppTour() {
  const active = useTourStore((s) => s.active);
  const offerOpen = useTourStore((s) => s.offerOpen);
  useAppTour();

  if (active) return <TourOverview />;
  if (offerOpen) return <TourOffer />;
  return null;
}

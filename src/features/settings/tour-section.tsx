import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/features/settings/settings-row";
import { useTourStore } from "@/lib/tour/store";

export function TourSection() {
  return (
    <div data-tour="tour-settings">
      <SettingsRow
        title="Produkttour"
        description="Kapitelweise Führung durch Verbindungen, Explorer, SQL und Einstellungen. Startet immer bei Kapitel 1."
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => useTourStore.getState().startFromBeginning()}
        >
          Tour von vorn
        </Button>
      </SettingsRow>
    </div>
  );
}

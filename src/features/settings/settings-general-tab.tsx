import { RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { SettingsAppearance } from "@/features/settings/settings-appearance";
import { SettingsRow } from "@/features/settings/settings-row";
import { SettingsTableTabs } from "@/features/settings/settings-table-tabs";
import { TourSection } from "@/features/settings/tour-section";
import { useSettingsStore } from "@/lib/settings";

export function SettingsGeneralTab() {
  const { theme, setTheme } = useTheme();
  const { resetToDefaults } = useSettingsStore();

  const handleReset = () => {
    resetToDefaults();
    setTheme("system");
    toast.success("Einstellungen wurden auf Standardwerte zurückgesetzt");
  };

  return (
    <div className="@container space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Allgemein</h2>
        <p className="text-xs text-muted-foreground">
          Grundlegende Darstellung und Verhalten der Benutzeroberfläche anpassen.
        </p>
      </div>

      <div className="space-y-3">
        <SettingsRow title="Erscheinungsbild" description="Hell, dunkel oder dem System folgen.">
          <SegmentedControl
            value={(theme ?? "system") as "light" | "system" | "dark"}
            onChange={setTheme}
            label="Erscheinungsbild"
            options={[
              { value: "light", label: "Hell" },
              { value: "system", label: "System" },
              { value: "dark", label: "Dunkel" },
            ]}
          />
        </SettingsRow>

        <SettingsAppearance />

        <SettingsTableTabs />

        <TourSection />

        <SettingsRow
          title="Werkseinstellungen"
          description="Alle Optionen auf die ursprünglichen Standardwerte zurücksetzen."
        >
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="size-3.5" />
            <span>Zurücksetzen</span>
          </Button>
        </SettingsRow>
      </div>
    </div>
  );
}

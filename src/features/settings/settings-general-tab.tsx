import { RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PortableWorkspacePanel } from "@/features/settings/portable-workspace-panel";
import { SettingsAppearance } from "@/features/settings/settings-appearance";
import { SettingsRow } from "@/features/settings/settings-row";
import { SettingsTableTabs } from "@/features/settings/settings-table-tabs";
import { TourSection } from "@/features/settings/tour-section";
import { useSettingsStore } from "@/lib/settings";

export function SettingsGeneralTab() {
  const { theme, setTheme } = useTheme();
  const {
    resetToDefaults,
    easyMode,
    setEasyMode,
    setOnboardingDone,
    translateFilterOperators,
    setTranslateFilterOperators,
  } = useSettingsStore();

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
        <SettingsRow
          title="Easy Mode"
          description="Weniger Ablenkung: Blendet MCP, Versionierung, Monitor, geteilte Ansichten und weitere Verwaltungswerkzeuge aus. Deine Arbeitsstände bleiben erhalten."
        >
          <Switch checked={easyMode} onCheckedChange={setEasyMode} aria-label="Easy Mode" />
        </SettingsRow>
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

        {!easyMode && <SettingsTableTabs />}

        <SettingsRow
          title="Filteroperatoren übersetzen"
          description="Bezeichnungen wie „ist gleich“ anzeigen. Ausgeschaltet erscheinen =, <>, IN, IS NULL und LIKE-Muster bzw. die nativen Operatoren der Datenbank."
        >
          <Switch
            checked={translateFilterOperators}
            onCheckedChange={setTranslateFilterOperators}
            aria-label="Filteroperatoren übersetzen"
          />
        </SettingsRow>

        <SettingsRow
          title="Onboarding"
          description="Intro, Theme- und Moduswahl vom ersten Start erneut anzeigen."
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOnboardingDone(false)}
          >
            Erneut anzeigen
          </Button>
        </SettingsRow>

        <TourSection />

        <PortableWorkspacePanel />

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

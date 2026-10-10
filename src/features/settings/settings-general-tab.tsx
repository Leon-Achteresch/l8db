import { RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PortableWorkspacePanel } from "@/features/settings/portable-workspace-panel";
import { SettingsRow } from "@/features/settings/settings-row";
import { SettingsTableTabs } from "@/features/settings/settings-table-tabs";
import { SyncPanel } from "@/features/settings/sync-panel";
import { TourSection } from "@/features/settings/tour-section";
import { useSettingsStore } from "@/lib/settings";

export function SettingsGeneralTab() {
  const { setTheme } = useTheme();
  const {
    resetToDefaults,
    easyMode,
    setEasyMode,
    setOnboardingDone,
    translateFilterOperators,
    setTranslateFilterOperators,
    hideOwnSchemaSelect,
    setHideOwnSchemaSelect,
    sidebarObjectNav,
    setSidebarObjectNav,
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
        <SettingsRow settingId="easy-mode">
          <Switch checked={easyMode} onCheckedChange={setEasyMode} aria-label="Easy Mode" />
        </SettingsRow>
        {!easyMode && <SettingsTableTabs />}

        <SettingsRow settingId="filter-operators">
          <Switch
            checked={translateFilterOperators}
            onCheckedChange={setTranslateFilterOperators}
            aria-label="Filteroperatoren übersetzen"
          />
        </SettingsRow>

        <SettingsRow settingId="hide-own-schema" featureId="settings.general.hide-own-schema">
          <Switch
            checked={hideOwnSchemaSelect}
            onCheckedChange={setHideOwnSchemaSelect}
            aria-label="Eigenes Schema ohne Auswahl"
          />
        </SettingsRow>

        <SettingsRow settingId="sidebar-object-nav" featureId="settings.general.sidebar-object-nav">
          <SegmentedControl
            value={sidebarObjectNav}
            onChange={setSidebarObjectNav}
            label="Objekttypen in der Seitenleiste"
            options={[
              { value: "tabs", label: "Tabbar" },
              { value: "select", label: "Auswahl" },
            ]}
          />
        </SettingsRow>

        <SettingsRow settingId="onboarding">
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

        <SyncPanel />

        <SettingsRow settingId="reset">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="size-3.5" />
            <span>Zurücksetzen</span>
          </Button>
        </SettingsRow>
      </div>
    </div>
  );
}

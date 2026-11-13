import { Switch } from "@/components/ui/switch";
import { SettingsAppThemes } from "@/features/settings/settings-app-themes";
import { SettingsAppearance } from "@/features/settings/settings-appearance";
import { SettingsColorScheme } from "@/features/settings/settings-color-scheme";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore } from "@/lib/settings";

export function SettingsAppearanceTab() {
  const dbThemes = useSettingsStore((state) => state.dbThemes);
  const setDbThemes = useSettingsStore((state) => state.setDbThemes);
  return (
    <div className="@container space-y-4">
      <h2 className="text-base font-semibold tracking-tight">Darstellung</h2>
      <div className="space-y-3">
        <SettingsRow settingId="theme" stacked>
          <SettingsColorScheme />
        </SettingsRow>
        <SettingsRow settingId="app-theme" featureId="settings.appearance.themes" stacked>
          <SettingsAppThemes />
        </SettingsRow>
        <SettingsRow settingId="db-themes" featureId="settings.appearance.db-themes">
          <Switch checked={dbThemes} onCheckedChange={setDbThemes} aria-label="Datenbank-Themes" />
        </SettingsRow>
        <SettingsAppearance />
      </div>
    </div>
  );
}

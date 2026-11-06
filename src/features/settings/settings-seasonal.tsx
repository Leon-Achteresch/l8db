import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore } from "@/lib/settings";

export function SettingsSeasonal() {
  const enabled = useSettingsStore((state) => state.seasonalAccents);
  const setEnabled = useSettingsStore((state) => state.setSeasonalAccents);
  return (
    <SettingsRow settingId="seasonal-accents" featureId="settings.appearance.seasonal">
      <Switch aria-label="Saisonale Akzente" checked={enabled} onCheckedChange={setEnabled} />
    </SettingsRow>
  );
}

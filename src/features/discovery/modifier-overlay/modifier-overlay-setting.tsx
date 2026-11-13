import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { useModifierOverlayStore } from "@/lib/discovery/modifier-overlay/settings";

export function ModifierOverlaySetting() {
  const enabled = useModifierOverlayStore((state) => state.enabled);
  const setEnabled = useModifierOverlayStore((state) => state.setEnabled);
  return (
    <SettingsRow title="Kürzel beim Halten zeigen" featureId="discover.modifier-overlay">
      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        aria-label="Kürzel beim Halten zeigen"
      />
    </SettingsRow>
  );
}

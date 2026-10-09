import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { TableStylePicker } from "@/features/settings/table-style-picker";
import { useSettingsStore } from "@/lib/settings";

export function SettingsTableAppearance() {
  const {
    fitColumnsToHeader,
    monochromeCells,
    tableStyle,
    setTableStyle,
    setFitColumnsToHeader,
    setMonochromeCells,
  } = useSettingsStore();
  return (
    <>
      <SettingsRow settingId="table-style" featureId="settings.appearance.table-style" stacked>
        <TableStylePicker value={tableStyle} onChange={setTableStyle} />
      </SettingsRow>
      <SettingsRow settingId="fit-columns-to-header">
        <Switch
          aria-label="An Spaltentitel anpassen"
          checked={fitColumnsToHeader}
          onCheckedChange={setFitColumnsToHeader}
        />
      </SettingsRow>
      <SettingsRow settingId="monochrome-cells">
        <Switch
          aria-label="Einfarbige Tabellenwerte"
          checked={monochromeCells}
          onCheckedChange={setMonochromeCells}
        />
      </SettingsRow>
    </>
  );
}

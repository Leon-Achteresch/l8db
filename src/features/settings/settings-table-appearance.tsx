import { SegmentedControl } from "@/components/motion/segmented-control";
import { Switch } from "@/components/ui/switch";
import { FilterBarStylePicker } from "@/features/settings/filter-bar-style-picker";
import { SettingsRow } from "@/features/settings/settings-row";
import { TableStylePicker } from "@/features/settings/table-style-picker";
import { useSettingsStore } from "@/lib/settings";

export function SettingsTableAppearance() {
  const {
    fitColumnsToHeader,
    monochromeCells,
    tableStyle,
    filterBarStyle,
    filterBarSorting,
    setTableStyle,
    setFilterBarStyle,
    setFilterBarSorting,
    tableFilterMode,
    setTableFilterMode,
    setFitColumnsToHeader,
    setMonochromeCells,
  } = useSettingsStore();
  return (
    <>
      <SettingsRow settingId="table-style" featureId="settings.appearance.table-style" stacked>
        <TableStylePicker value={tableStyle} onChange={setTableStyle} />
      </SettingsRow>
      <SettingsRow settingId="filter-bar-style" featureId="settings.appearance.filter-bar" stacked>
        <FilterBarStylePicker value={filterBarStyle} onChange={setFilterBarStyle} />
      </SettingsRow>
      <SettingsRow settingId="filter-bar-sorting" featureId="settings.appearance.filter-sorting">
        <Switch
          aria-label="Sortierung in der Filterleiste"
          checked={filterBarSorting}
          onCheckedChange={setFilterBarSorting}
        />
      </SettingsRow>
      <SettingsRow settingId="table-filter-mode" featureId="settings.appearance.filter-mode">
        <SegmentedControl
          value={tableFilterMode}
          onChange={setTableFilterMode}
          label="Standardmodus für Tabellenfilter"
          options={[
            { value: "simple", label: "Einfach" },
            { value: "sql", label: "SQL" },
          ]}
        />
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

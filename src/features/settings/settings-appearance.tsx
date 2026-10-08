import { Minus, Plus, RotateCcw } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { TableStylePicker } from "@/features/settings/table-style-picker";
import { islandName, previewIsland } from "@/lib/dynamic-island";
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, useSettingsStore } from "@/lib/settings";

export function SettingsAppearance() {
  const {
    uiScale,
    uiDensity,
    sidebarExtraCompact,
    navInHeader,
    dynamicIsland,
    fitColumnsToHeader,
    monochromeCells,
    tableStyle,
    setTableStyle,
    setSidebarExtraCompact,
    setNavInHeader,
    setDynamicIsland,
    setFitColumnsToHeader,
    setMonochromeCells,
    setUiScale,
    setUiDensity,
    resetAppearance,
  } = useSettingsStore();
  return (
    <>
      <SettingsRow settingId="ui-scale">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Oberfläche verkleinern"
            disabled={uiScale <= UI_SCALE_MIN}
            onClick={() => setUiScale(uiScale - UI_SCALE_STEP)}
          >
            <Minus className="size-3.5" />
          </Button>
          <input
            type="range"
            aria-label="Oberflächengröße"
            aria-valuetext={`${uiScale} Prozent`}
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={UI_SCALE_STEP}
            value={uiScale}
            onChange={(event) => setUiScale(Number(event.target.value))}
            className="w-24 accent-primary"
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Oberfläche vergrößern"
            disabled={uiScale >= UI_SCALE_MAX}
            onClick={() => setUiScale(uiScale + UI_SCALE_STEP)}
          >
            <Plus className="size-3.5" />
          </Button>
          <output className="w-12 text-right text-xs tabular-nums" aria-live="polite">
            {uiScale} %
          </output>
        </div>
      </SettingsRow>
      <SettingsRow settingId="density">
        <SegmentedControl
          value={uiDensity}
          onChange={setUiDensity}
          label="UI-Dichte"
          options={[
            { value: "compact", label: "Kompakt" },
            { value: "normal", label: "Standard" },
            { value: "spacious", label: "Großzügig" },
          ]}
        />
      </SettingsRow>
      <SettingsRow settingId="sidebar-extra-compact">
        <Switch
          aria-label="Seitenleiste extra kompakt"
          checked={sidebarExtraCompact}
          onCheckedChange={setSidebarExtraCompact}
        />
      </SettingsRow>
      <SettingsRow settingId="nav-in-header">
        <Switch
          aria-label="Navigation im Header"
          checked={navInHeader}
          onCheckedChange={setNavInHeader}
        />
      </SettingsRow>
      <SettingsRow settingId="dynamic-island" featureId="settings.general.dynamic-island">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!dynamicIsland}
            onClick={() => void islandName().then(previewIsland)}
          >
            Vorschau
          </Button>
          <Switch
            aria-label="Dynamic Island"
            checked={dynamicIsland}
            onCheckedChange={setDynamicIsland}
          />
        </div>
      </SettingsRow>
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
      <SettingsRow settingId="reset-appearance">
        <Button
          variant="outline"
          size="sm"
          disabled={
            uiScale === 100 &&
            uiDensity === "normal" &&
            !sidebarExtraCompact &&
            !navInHeader &&
            dynamicIsland &&
            fitColumnsToHeader &&
            monochromeCells &&
            tableStyle === "classic"
          }
          onClick={resetAppearance}
        >
          <RotateCcw className="size-3.5" />
          Zurücksetzen
        </Button>
      </SettingsRow>
    </>
  );
}

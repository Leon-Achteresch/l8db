import { Minus, Plus, RotateCcw } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, useSettingsStore } from "@/lib/settings";

export function SettingsAppearance() {
  const {
    uiScale,
    uiDensity,
    sidebarExtraCompact,
    setSidebarExtraCompact,
    setUiScale,
    setUiDensity,
    resetAppearance,
  } = useSettingsStore();
  return (
    <>
      <SettingsRow
        title="Oberflächengröße"
        description="Schrift, Symbole und Bedienelemente in der gesamten App verkleinern oder vergrößern (80–150 %). Die Code-Schrift bleibt separat im SQL-Editor einstellbar."
      >
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
      <SettingsRow
        title="UI-Dichte"
        description="Zeilenhöhen und Abstände in Seitenleiste, Tabellen, Menüs und Steuerelementen. Die Schriftgröße bleibt gleich."
      >
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
      <SettingsRow
        title="Seitenleiste extra kompakt"
        description="Objektlisten ohne Zwischenräume und mit 20 px Zeilenhöhe bei 100 %. Die Schriftgröße bleibt erhalten. Gilt unabhängig von der UI-Dichte."
      >
        <Switch
          aria-label="Seitenleiste extra kompakt"
          checked={sidebarExtraCompact}
          onCheckedChange={setSidebarExtraCompact}
        />
      </SettingsRow>
      <SettingsRow
        title="Darstellung zurücksetzen"
        description="Oberflächengröße, UI-Dichte und Seitenleistenabstände auf Standard zurücksetzen. Änderungen werden sofort angewendet und gespeichert."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={uiScale === 100 && uiDensity === "normal" && !sidebarExtraCompact}
          onClick={resetAppearance}
        >
          <RotateCcw className="size-3.5" />
          Zurücksetzen
        </Button>
      </SettingsRow>
    </>
  );
}

import { useState } from "react";
import { EffortCycle } from "./model-picker/effort-cycle";
import { IslandPicker } from "./model-picker/island-picker";
import { LAB_DEFAULT, type LabSelection, labLookup } from "./model-picker/model-picker-data";
import { PalettePicker } from "./model-picker/palette-picker";
import { PickerStage } from "./model-picker/picker-stage";
import { QuickChips } from "./model-picker/quick-chips";
import { RailPicker } from "./model-picker/rail-picker";

const IDS = ["palette", "rail", "island", "quick"] as const;

export function ModelPickerLab() {
  const [values, setValues] = useState<Record<string, LabSelection>>({});
  const [revision, setRevision] = useState(0);
  const get = (id: string) => values[id] ?? LAB_DEFAULT;
  const set = (id: string) => (value: LabSelection) =>
    setValues((all) => ({ ...all, [id]: value }));
  const summary = (id: string) => {
    const { provider, model } = labLookup(get(id));
    return `${provider.short} · ${model.name} · ${get(id).effort}`;
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Modellpicker</h2>
          <p className="text-sm text-muted-foreground">Vier Entwürfe mit Motion, Beispieldaten.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setValues({});
            setRevision(revision + 1);
          }}
          className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          Zurücksetzen
        </button>
      </div>
      <div key={revision} className="grid gap-6 xl:grid-cols-2">
        <PickerStage
          index="01"
          title="Suche zuerst"
          description={`Command-Palette: tippen, Pfeiltasten, Enter. Hover gleitet mit. ${summary(IDS[0])}`}
        >
          <PalettePicker value={get(IDS[0])} onChange={set(IDS[0])} />
        </PickerStage>
        <PickerStage
          index="02"
          title="Anbieter-Leiste"
          description={`Logos links, Modelle rechts mit Tempo/Tiefe. Wechsel gleitet vertikal. ${summary(IDS[1])}`}
        >
          <RailPicker value={get(IDS[1])} onChange={set(IDS[1])} />
        </PickerStage>
        <PickerStage
          index="03"
          title="Morphende Pille"
          description={`Die Pille wächst zum Panel und zurück. Modelle als Karten. ${summary(IDS[2])}`}
        >
          <IslandPicker value={get(IDS[2])} onChange={set(IDS[2])} />
        </PickerStage>
        <PickerStage
          index="04"
          title="Schnellwahl + Sheet"
          description={`Zuletzt genutzte Modelle als Chips, alle im Sheet (nach unten wischen). ${summary(IDS[3])}`}
          above={<QuickChips value={get(IDS[3])} onChange={set(IDS[3])} />}
        >
          <EffortCycle
            value={get(IDS[3]).effort}
            onChange={(effort) => set(IDS[3])({ ...get(IDS[3]), effort })}
          />
        </PickerStage>
      </div>
    </div>
  );
}

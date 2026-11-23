import type { LabSelection } from "./model-picker-data";
import { PaletteBody } from "./palette-body";
import { PickerShell } from "./picker-shell";
import { PickerTrigger } from "./picker-trigger";

export function PalettePicker({
  value,
  onChange,
}: {
  value: LabSelection;
  onChange: (value: LabSelection) => void;
}) {
  return (
    <PickerShell
      className="w-[340px]"
      trigger={(open, toggle) => <PickerTrigger selection={value} open={open} onClick={toggle} />}
    >
      {(close) => <PaletteBody value={value} onChange={onChange} onDone={close} />}
    </PickerShell>
  );
}

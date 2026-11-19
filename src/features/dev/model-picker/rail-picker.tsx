import type { LabSelection } from "./model-picker-data";
import { PickerShell } from "./picker-shell";
import { PickerTrigger } from "./picker-trigger";
import { RailBody } from "./rail-body";

export function RailPicker({
  value,
  onChange,
}: {
  value: LabSelection;
  onChange: (value: LabSelection) => void;
}) {
  return (
    <PickerShell
      className="w-[380px]"
      trigger={(open, toggle) => <PickerTrigger selection={value} open={open} onClick={toggle} />}
    >
      {(close) => <RailBody value={value} onChange={onChange} onDone={close} />}
    </PickerShell>
  );
}

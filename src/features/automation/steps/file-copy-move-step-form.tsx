import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";

export function FileCopyMoveStepForm({
  action,
  onChange,
}: StepFormProps<"file_copy" | "file_move">) {
  const fromError = useFieldError("from");
  const toError = useFieldError("to");
  const verb = action.type === "file_move" ? "verschieben" : "kopieren";

  return (
    <div className="flex flex-col gap-4">
      <FormRow
        label="Quelle"
        error={fromError}
        hint="* und ? im Dateinamen erlaubt, etwa berichte/*.csv"
      >
        <PathInput
          mode="open"
          value={action.from}
          placeholder="${output_dir}/berichte/*.csv"
          onChange={(from) => onChange({ ...action, from })}
        />
      </FormRow>
      <FormRow label="Ziel" error={toError} hint="Endet das Ziel mit /, ist es ein Ordner.">
        <PathInput
          mode="directory"
          value={action.to}
          placeholder="/Volumes/Archiv/berichte/"
          onChange={(to) => onChange({ ...action, to })}
        />
      </FormRow>
      <SwitchRow
        label="Vorhandene Dateien überschreiben"
        description={`Sonst schlägt das ${verb === "kopieren" ? "Kopieren" : "Verschieben"} fehl, wenn das Ziel existiert.`}
        checked={action.overwrite}
        onCheckedChange={(overwrite) => onChange({ ...action, overwrite })}
      />
    </div>
  );
}

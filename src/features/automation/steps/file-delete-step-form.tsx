import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { type StepFormProps, useFieldError } from "../step-form-context";

export function FileDeleteStepForm({ action, onChange }: StepFormProps<"file_delete">) {
  const error = useFieldError("path");
  return (
    <FormRow
      label="Dateien"
      error={error}
      hint="Löscht nur Dateien, keine Ordner. * und ? im Dateinamen erlaubt. Keine Treffer sind kein Fehler."
    >
      <PathInput
        mode="open"
        value={action.path}
        placeholder="${output_dir}/tmp/*.tmp"
        onChange={(path) => onChange({ ...action, path })}
      />
    </FormRow>
  );
}

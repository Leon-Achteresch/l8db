import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { type StepFormProps, useFieldError } from "../step-form-context";

export function MkdirStepForm({ action, onChange }: StepFormProps<"mkdir">) {
  const error = useFieldError("path");
  return (
    <FormRow label="Ordner" error={error} hint="Fehlende Elternordner werden mit angelegt.">
      <PathInput
        mode="directory"
        value={action.path}
        placeholder="${output_dir}/berichte/${date:%Y/%m}"
        onChange={(path) => onChange({ ...action, path })}
      />
    </FormRow>
  );
}

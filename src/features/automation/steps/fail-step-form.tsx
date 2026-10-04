import { FormRow } from "../form-row";
import { type StepFormProps, useFieldError } from "../step-form-context";
import { TemplateInput } from "../template-input";

export function FailStepForm({ action, onChange }: StepFormProps<"fail">) {
  const error = useFieldError("message");
  return (
    <FormRow
      label="Meldung"
      error={error}
      hint="Beendet den Lauf als fehlgeschlagen, ohne Wiederholung. Meist hinter einer Bedingung."
    >
      <TemplateInput
        value={action.message}
        placeholder="Keine neuen Daten für ${date-1d}."
        onChange={(message) => onChange({ ...action, message })}
      />
    </FormRow>
  );
}

import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { optionalText, type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

export function FileExistsStepForm({ action, onChange }: StepFormProps<"file_exists">) {
  const error = useFieldError("path");
  return (
    <div className="flex flex-col gap-4">
      <FormRow label="Datei" error={error} hint="* und ? im Dateinamen erlaubt.">
        <PathInput
          mode="open"
          value={action.path}
          placeholder="/import/fertig.flag"
          onChange={(path) => onChange({ ...action, path })}
        />
      </FormRow>
      <SwitchRow
        label="Fehlschlagen, wenn sie fehlt"
        checked={action.failIfMissing}
        onCheckedChange={(failIfMissing) => onChange({ ...action, failIfMissing })}
      />
      <FormRow
        label="Ergebnis in Variable"
        hint="„true“ oder „false“, etwa für eine Bedingung."
        className="max-w-72"
      >
        <TemplateInput
          value={action.capture ?? ""}
          placeholder="vorhanden"
          mono
          onChange={(capture) => onChange({ ...action, capture: optionalText(capture) })}
        />
      </FormRow>
    </div>
  );
}

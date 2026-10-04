import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";

export function UnzipStepForm({ action, onChange }: StepFormProps<"unzip">) {
  const archiveError = useFieldError("archive");
  const targetError = useFieldError("target");
  return (
    <div className="flex flex-col gap-4">
      <FormRow label="Archiv" error={archiveError}>
        <PathInput
          mode="open"
          extensions={["zip"]}
          value={action.archive}
          placeholder="/import/lieferung.zip"
          onChange={(archive) => onChange({ ...action, archive })}
        />
      </FormRow>
      <FormRow label="Zielordner" error={targetError}>
        <PathInput
          mode="directory"
          value={action.target}
          placeholder="/import/entpackt"
          onChange={(target) => onChange({ ...action, target })}
        />
      </FormRow>
      <SwitchRow
        label="Vorhandene Dateien überschreiben"
        description="An: Gleichnamige Dateien im Zielordner werden ersetzt. Aus: Der Schritt bricht vor dem Entpacken ab, sobald eine Datei schon existiert. Einträge mit .. oder absoluten Pfaden werden immer abgelehnt."
        checked={action.overwrite}
        onCheckedChange={(overwrite) => onChange({ ...action, overwrite })}
      />
    </div>
  );
}

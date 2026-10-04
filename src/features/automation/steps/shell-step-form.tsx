import { ChipsInput } from "../chips-input";
import { FormRow } from "../form-row";
import { KeyValueFields } from "../key-value-fields";
import { PathInput } from "../path-input";
import { optionalText, type StepFormProps, useFieldError } from "../step-form-context";
import { TemplateInput } from "../template-input";

export function ShellStepForm({ action, onChange }: StepFormProps<"shell">) {
  const programError = useFieldError("program");
  const codesError = useFieldError("successCodes");

  return (
    <div className="flex flex-col gap-4">
      <FormRow
        label="Programm"
        error={programError}
        hint={
          <>
            Läuft ohne Shell. Für Pipes oder Umleitungen <code className="font-mono">sh</code> mit{" "}
            <code className="font-mono">-c</code> nutzen.
          </>
        }
      >
        <PathInput
          mode="open"
          value={action.program}
          placeholder="/usr/local/bin/pg_dump"
          onChange={(program) => onChange({ ...action, program })}
        />
      </FormRow>
      <FormRow label="Argumente" hint="Ein Argument pro Eintrag, Enter fügt hinzu.">
        <ChipsInput
          value={action.args}
          itemLabel="Argument"
          mono
          separators={/\n/}
          placeholder="--verbose"
          onChange={(args) => onChange({ ...action, args })}
        />
      </FormRow>
      <FormRow label="Arbeitsordner">
        <PathInput
          mode="directory"
          value={action.cwd ?? ""}
          placeholder="Standard"
          onChange={(cwd) => onChange({ ...action, cwd: optionalText(cwd) })}
        />
      </FormRow>
      <FormRow label="Umgebungsvariablen" bind={false}>
        <KeyValueFields
          value={action.env}
          keyLabel="Name"
          valueLabel="Wert"
          keyPlaceholder="NAME"
          valuePlaceholder="Wert"
          addLabel="Variable hinzufügen"
          onChange={(env) => onChange({ ...action, env })}
        />
      </FormRow>
      <div className="grid gap-4 @lg/step:grid-cols-2">
        <FormRow label="Erfolgreiche Exit-Codes" error={codesError}>
          <ChipsInput
            value={action.successCodes.map(String)}
            itemLabel="Code"
            mono
            validate={(entry) => (/^-?\d+$/.test(entry) ? null : `„${entry}“ ist keine Zahl.`)}
            onChange={(codes) => onChange({ ...action, successCodes: codes.map(Number) })}
          />
        </FormRow>
        <FormRow label="Ausgabe in Variable" hint="stdout, ohne Rand-Leerzeichen">
          <TemplateInput
            value={action.capture ?? ""}
            placeholder="ausgabe"
            mono
            onChange={(capture) => onChange({ ...action, capture: optionalText(capture) })}
          />
        </FormRow>
      </div>
    </div>
  );
}

import { ChipsInput } from "../chips-input";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { OutputSpecFields } from "../output-spec-fields";
import { type StepFormProps, useFieldError } from "../step-form-context";

export function ZipStepForm({ action, onChange }: StepFormProps<"zip">) {
  const error = useFieldError("sources");
  return (
    <div className="flex flex-col gap-8">
      <FormSection title="Quellen">
        <FormRow
          label="Dateien"
          error={error}
          hint="Ein Pfad pro Eintrag, * und ? im Dateinamen erlaubt."
        >
          <ChipsInput
            value={action.sources}
            itemLabel="Quelle"
            mono
            separators={/\n/}
            placeholder="${output_dir}/berichte/*.csv"
            onChange={(sources) => onChange({ ...action, sources })}
          />
        </FormRow>
      </FormSection>
      <FormSection title="Archiv">
        <OutputSpecFields
          value={action.output}
          extension="zip"
          allowAppend={false}
          allowZip={false}
          onChange={(output) => onChange({ ...action, output })}
        />
      </FormSection>
    </div>
  );
}

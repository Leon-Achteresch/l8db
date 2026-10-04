import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import type { BackupContent } from "@/lib/db/backup";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { OutputSpecFields } from "../output-spec-fields";
import { optionalNumber, optionalText, type StepFormProps } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

const CONTENT: { value: BackupContent; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "schema", label: "Nur Schema" },
  { value: "data", label: "Nur Daten" },
];

export function BackupStepForm({ action, onChange }: StepFormProps<"backup">) {
  const options = action.options;
  const setOptions = (patch: Partial<typeof options>) =>
    onChange({ ...action, options: { ...options, ...patch } });

  return (
    <div className="flex flex-col gap-8">
      <FormSection title="Quelle">
        <ConnectionFields
          connection={action.connection}
          database={action.database}
          capability="backup"
          onChange={(next) => onChange({ ...action, ...next })}
        />
        <div className="grid gap-4 @lg/step:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <FormRow label="Inhalt" bind={false}>
            <SegmentedControl
              label="Inhalt"
              value={options.content ?? "all"}
              options={CONTENT}
              onChange={(content) => setOptions({ content })}
            />
          </FormRow>
          <FormRow label="Format" hint="Leer = Standard des Werkzeugs, z. B. custom bei PostgreSQL">
            <TemplateInput
              value={options.format ?? ""}
              placeholder="Standard"
              mono
              onChange={(format) => setOptions({ format: optionalText(format) ?? undefined })}
            />
          </FormRow>
        </div>
        <div className="grid gap-4 @lg/step:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-3">
            <SwitchRow
              label="Komprimieren"
              description="gzip, sofern das Format es nicht ohnehin tut."
              checked={Boolean(options.gzip)}
              onCheckedChange={(gzip) => setOptions({ gzip })}
            />
            <SwitchRow
              label="Ohne Eigentümer"
              description="Besitzrechte nicht mitsichern, damit das Backup in jede Datenbank passt."
              checked={Boolean(options.noOwner)}
              onCheckedChange={(noOwner) => setOptions({ noOwner })}
            />
          </div>
          <FormRow label="Parallele Jobs" hint="Leer = ein Job. Nur bei Formaten, die das können.">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="1"
              value={options.jobs ?? ""}
              onChange={(event) => setOptions({ jobs: optionalNumber(event.target.value) })}
            />
          </FormRow>
        </div>
      </FormSection>
      <FormSection title="Ziel">
        <OutputSpecFields
          value={action.output}
          extension="dump"
          allowAppend={false}
          onChange={(output) => onChange({ ...action, output })}
        />
      </FormSection>
    </div>
  );
}

import { SegmentedControl } from "@/components/motion/segmented-control";
import type { Severity } from "@/lib/db/automation";
import { CheckSpecFields } from "../check-spec-fields";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import type { StepFormProps } from "../step-form-context";

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "error", label: "Fehler" },
  { value: "warning", label: "Warnung" },
];

export function CheckStepForm({ action, onChange }: StepFormProps<"check">) {
  return (
    <div className="flex flex-col gap-4">
      <ConnectionFields
        connection={action.connection}
        database={action.database}
        onChange={(next) => onChange({ ...action, ...next })}
      />
      <CheckSpecFields value={action.check} onChange={(check) => onChange({ ...action, check })} />
      <FormRow
        label="Bei Verstoß"
        hint={
          action.severity === "error"
            ? "Der Schritt schlägt fehl; es gilt „Bei Fehler“."
            : "Der Lauf endet „mit Warnungen“, die nächsten Schritte laufen weiter."
        }
        bind={false}
        className="max-w-72"
      >
        <SegmentedControl
          label="Schwere bei Verstoß"
          value={action.severity}
          options={SEVERITIES}
          onChange={(severity) => onChange({ ...action, severity })}
        />
      </FormRow>
    </div>
  );
}

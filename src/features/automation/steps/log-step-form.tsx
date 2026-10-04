import { SegmentedControl } from "@/components/motion/segmented-control";
import { LOG_LEVEL_LABELS } from "@/lib/automation/labels";
import type { LogLevel } from "@/lib/db/automation";
import { FormRow } from "../form-row";
import { type StepFormProps, useFieldError } from "../step-form-context";
import { TemplateInput } from "../template-input";

const LEVELS = (Object.keys(LOG_LEVEL_LABELS) as LogLevel[]).map((value) => ({
  value,
  label: LOG_LEVEL_LABELS[value],
}));

export function LogStepForm({ action, onChange }: StepFormProps<"log">) {
  const error = useFieldError("message");
  return (
    <div className="flex flex-col gap-4">
      <FormRow label="Stufe" bind={false} className="max-w-sm">
        <SegmentedControl
          label="Stufe"
          value={action.level}
          options={LEVELS}
          onChange={(level) => onChange({ ...action, level })}
        />
      </FormRow>
      <FormRow label="Text" error={error}>
        <TemplateInput
          multiline
          rows={3}
          value={action.message}
          placeholder="Export enthielt ${last.rows} Zeilen."
          onChange={(message) => onChange({ ...action, message })}
        />
      </FormRow>
    </div>
  );
}

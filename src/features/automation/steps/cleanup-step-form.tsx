import { Input } from "@/components/ui/input";
import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { optionalNumber, type StepFormProps, useFieldError } from "../step-form-context";
import { TemplateInput } from "../template-input";

export function CleanupStepForm({ action, onChange }: StepFormProps<"cleanup">) {
  const dirError = useFieldError("dir");
  const patternError = useFieldError("pattern");
  const cleanupError = useFieldError("cleanup");
  const cleanup = action.cleanup;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 @lg/step:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <FormRow label="Ordner" error={dirError}>
          <PathInput
            mode="directory"
            value={action.dir}
            placeholder="${output_dir}/backups"
            onChange={(dir) => onChange({ ...action, dir })}
          />
        </FormRow>
        <FormRow label="Muster" error={patternError}>
          <TemplateInput
            value={action.pattern}
            placeholder="*.dump"
            mono
            onChange={(pattern) => onChange({ ...action, pattern })}
          />
        </FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Löschen, wenn älter als (Tage)" error={cleanupError}>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="egal"
            value={cleanup.olderThanDays ?? ""}
            onChange={(event) =>
              onChange({
                ...action,
                cleanup: { ...cleanup, olderThanDays: optionalNumber(event.target.value) },
              })
            }
          />
        </FormRow>
        <FormRow label="Neueste behalten">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="alle"
            value={cleanup.keepLast ?? ""}
            onChange={(event) =>
              onChange({
                ...action,
                cleanup: { ...cleanup, keepLast: optionalNumber(event.target.value) },
              })
            }
          />
        </FormRow>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        Zuerst werden alle Dateien gelöscht, die älter sind; danach bleiben von den übrigen nur die
        neuesten erhalten.
      </p>
    </div>
  );
}

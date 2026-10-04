import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Step } from "@/lib/db/automation";
import { FlowSelect } from "./flow-select";
import { FormRow } from "./form-row";
import { FormSection } from "./form-section";
import { describeRetry, RetryFields } from "./retry-fields";
import { optionalNumber, useFieldError, useStepForm } from "./step-form-context";

interface Props {
  step: Step;
  onChange: (step: Step) => void;
}

export function StepFlowFields({ step, onChange }: Props) {
  const { siblings, task } = useStepForm();
  const continueId = useId();
  const successError = useFieldError("onSuccess");
  const failureError = useFieldError("onFailure");
  const timeoutError = useFieldError("timeoutSeconds");
  const isCondition = step.action.type === "condition";
  const retryable = step.action.type !== "fail" && !isCondition;
  const inherited = task.retry
    ? `Wie Task-Standard: ${describeRetry(task.retry)}`
    : "Nicht wiederholen";

  return (
    <FormSection
      title="Ablauf"
      description="Was nach diesem Schritt passiert, wie oft er es erneut versucht und wie lange er laufen darf."
    >
      <div className="grid gap-4 @lg/step:grid-cols-2">
        {!isCondition && (
          <FormRow label="Bei Erfolg" error={successError} bind={false}>
            <FlowSelect
              label="Bei Erfolg"
              value={step.onSuccess}
              siblings={siblings}
              currentId={step.id}
              aria-invalid={Boolean(successError)}
              onChange={(onSuccess) => onChange({ ...step, onSuccess })}
            />
          </FormRow>
        )}
        <FormRow
          label="Bei Fehler"
          error={failureError}
          bind={false}
          aside={
            <span className="flex items-center gap-2">
              <Label htmlFor={continueId} className="text-xs font-normal text-muted-foreground">
                Fortsetzen
              </Label>
              <Switch
                id={continueId}
                size="sm"
                checked={step.onFailure.type === "next"}
                onCheckedChange={(checked) =>
                  onChange({ ...step, onFailure: { type: checked ? "next" : "end_failure" } })
                }
              />
            </span>
          }
        >
          <FlowSelect
            label="Bei Fehler"
            value={step.onFailure}
            siblings={siblings}
            currentId={step.id}
            aria-invalid={Boolean(failureError)}
            onChange={(onFailure) => onChange({ ...step, onFailure })}
          />
        </FormRow>
      </div>
      {retryable ? (
        <FormRow label="Wiederholen bei Fehler" bind={false}>
          <RetryFields
            value={step.retry}
            offLabel={inherited}
            onChange={(retry) => onChange({ ...step, retry })}
          />
        </FormRow>
      ) : (
        <p className="text-xs text-muted-foreground">
          {isCondition
            ? "Bedingungen werden nicht wiederholt; der Sprung ergibt sich aus „Dann“ und „Sonst“."
            : "„Mit Fehler abbrechen“ wird nie wiederholt."}
        </p>
      )}
      <FormRow
        label="Timeout"
        error={timeoutError}
        hint="Leer lassen für kein eigenes Limit. Läuft der Schritt länger, zählt das als Fehler."
        className="max-w-48"
      >
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="Sekunden"
          value={step.timeoutSeconds ?? ""}
          onChange={(event) =>
            onChange({ ...step, timeoutSeconds: optionalNumber(event.target.value) })
          }
        />
      </FormRow>
    </FormSection>
  );
}

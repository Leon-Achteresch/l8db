import { Input } from "@/components/ui/input";
import { AlertConditionFields } from "../alert-condition-fields";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { SqlTemplateEditor } from "../sql-template-editor";
import { optionalNumber, type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";

export function AlertStepForm({ action, onChange }: StepFormProps<"alert">) {
  const sqlError = useFieldError("sql");

  return (
    <div className="flex flex-col gap-8">
      <FormSection
        title="Abfrage"
        description="Der Schritt gelingt auch, wenn der Alarm auslöst. Benachrichtigt wird nur bei Zustandswechseln; die Regeln dafür stehen unter „Benachrichtigungen“."
      >
        <ConnectionFields
          connection={action.connection}
          database={action.database}
          onChange={(next) => onChange({ ...action, ...next })}
        />
        <FormRow label="SQL" error={sqlError}>
          <SqlTemplateEditor
            label="Abfrage des Alarms"
            value={action.sql}
            placeholder="SELECT count(*) AS offen FROM orders WHERE status = 'pending'"
            onChange={(sql) => onChange({ ...action, sql })}
          />
        </FormRow>
      </FormSection>
      <FormSection title="Bedingung">
        <AlertConditionFields
          value={action.condition}
          onChange={(condition) => onChange({ ...action, condition })}
        />
        <FormRow
          label="Erneut erinnern nach (Min.)"
          hint="Leer = nur einmal pro Auslösung"
          className="max-w-56"
        >
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="nie"
            value={action.rearmMinutes ?? ""}
            onChange={(event) =>
              onChange({ ...action, rearmMinutes: optionalNumber(event.target.value) })
            }
          />
        </FormRow>
        <SwitchRow
          label="Entwarnung senden"
          description="Meldet sich, sobald die Bedingung nicht mehr zutrifft."
          checked={action.notifyOnResolve}
          onCheckedChange={(notifyOnResolve) => onChange({ ...action, notifyOnResolve })}
        />
      </FormSection>
    </div>
  );
}

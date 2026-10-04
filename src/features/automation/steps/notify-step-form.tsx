import { ChannelFields } from "../channel-fields";
import { FormRow } from "../form-row";
import type { StepFormProps } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

export function NotifyStepForm({ action, onChange }: StepFormProps<"notify">) {
  return (
    <div className="flex flex-col gap-4">
      <ChannelFields
        value={action.channel}
        onChange={(channel) => onChange({ ...action, channel })}
      />
      <FormRow label="Titel">
        <TemplateInput
          value={action.title}
          placeholder="${task}: Zwischenstand"
          onChange={(title) => onChange({ ...action, title })}
        />
      </FormRow>
      <FormRow label="Text">
        <TemplateInput
          multiline
          rows={4}
          value={action.body}
          placeholder={"Bisher ${last.rows} Zeilen verarbeitet."}
          onChange={(body) => onChange({ ...action, body })}
        />
      </FormRow>
      <SwitchRow
        label="Bisherige Ausgaben anhängen"
        description="E-Mail als Anhang, sonst als Pfade im Text."
        checked={action.attachOutputs}
        onCheckedChange={(attachOutputs) => onChange({ ...action, attachOutputs })}
      />
    </div>
  );
}

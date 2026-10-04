import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HTTP_METHODS } from "@/lib/automation/labels";
import type { HttpMethod } from "@/lib/db/automation";
import { FormRow } from "../form-row";
import { KeyValueFields } from "../key-value-fields";
import { optionalText, type StepFormProps, useFieldError } from "../step-form-context";
import { TemplateInput } from "../template-input";

export function HttpStepForm({ action, onChange }: StepFormProps<"http">) {
  const urlError = useFieldError("url");
  const statusError = useFieldError("expectStatus");
  const hasBody = action.method !== "get" && action.method !== "delete";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
        <FormRow label="Methode" bind={false}>
          <Select
            value={action.method}
            onValueChange={(method) => onChange({ ...action, method: method as HttpMethod })}
          >
            <SelectTrigger aria-label="Methode" className="w-full rounded-lg font-mono text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((method) => (
                <SelectItem key={method} value={method} className="font-mono text-[13px]">
                  {method.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        <FormRow label="URL" error={urlError}>
          <TemplateInput
            value={action.url}
            placeholder="https://example.com/hook?lauf=${run_id|url}"
            mono
            onChange={(url) => onChange({ ...action, url })}
          />
        </FormRow>
      </div>
      <FormRow label="Header" bind={false}>
        <KeyValueFields
          value={action.headers}
          keyLabel="Header"
          valueLabel="Wert"
          keyPlaceholder="Authorization"
          valuePlaceholder="Bearer ${api_token}"
          addLabel="Header hinzufügen"
          onChange={(headers) => onChange({ ...action, headers })}
        />
      </FormRow>
      {hasBody && (
        <FormRow label="Body">
          <TemplateInput
            multiline
            rows={5}
            mono
            value={action.body ?? ""}
            placeholder={'{"task": "${task|json}", "status": "${last.status}"}'}
            onChange={(body) => onChange({ ...action, body: optionalText(body) })}
          />
        </FormRow>
      )}
      <div className="grid gap-4 @lg/step:grid-cols-2">
        <FormRow label="Erwarteter Status" error={statusError} hint="Leer = 200-299">
          <TemplateInput
            value={action.expectStatus ?? ""}
            placeholder="200-299"
            mono
            onChange={(expectStatus) =>
              onChange({ ...action, expectStatus: optionalText(expectStatus) })
            }
          />
        </FormRow>
        <FormRow label="Antwort in Variable">
          <TemplateInput
            value={action.capture ?? ""}
            placeholder="antwort"
            mono
            onChange={(capture) => onChange({ ...action, capture: optionalText(capture) })}
          />
        </FormRow>
      </div>
    </div>
  );
}

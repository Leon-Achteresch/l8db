import { WorkflowIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormRow } from "../form-row";
import { KeyValueFields } from "../key-value-fields";
import { optionalText, type StepFormProps, useFieldError, useStepForm } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

export function RunTaskStepForm({ action, onChange }: StepFormProps<"run_task">) {
  const { tasks, task } = useStepForm();
  const error = useFieldError("task");
  const others = tasks.filter((entry) => entry.task.id !== task.id);
  const known = others.some((entry) => entry.task.id === action.task);

  return (
    <div className="flex flex-col gap-4">
      <FormRow label="Task" error={error} bind={false}>
        <Select value={action.task} onValueChange={(next) => onChange({ ...action, task: next })}>
          <SelectTrigger
            aria-label="Task"
            aria-invalid={Boolean(error)}
            className="w-full rounded-lg"
          >
            <SelectValue placeholder="Task wählen" />
          </SelectTrigger>
          <SelectContent searchable>
            {action.task && !known && (
              <SelectItem value={action.task}>„{action.task}“ (nicht gefunden)</SelectItem>
            )}
            {others.map((entry) => (
              <SelectItem key={entry.task.id} value={entry.task.id}>
                <WorkflowIcon className="size-3.5 text-muted-foreground" />
                {entry.task.name}
                {entry.task.folder && (
                  <span className="text-muted-foreground">{entry.task.folder}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormRow>
      <SwitchRow
        label="Auf Ende warten"
        description="Schlägt der gestartete Task fehl, schlägt auch dieser Schritt fehl."
        checked={action.wait}
        onCheckedChange={(wait) => onChange({ ...action, wait })}
      />
      <FormRow label="Umgebung" hint="Leer = Standard des gestarteten Tasks" className="max-w-72">
        <TemplateInput
          value={action.environment ?? ""}
          placeholder="Standard"
          onChange={(environment) =>
            onChange({ ...action, environment: optionalText(environment) })
          }
        />
      </FormRow>
      <FormRow label="Variablen übergeben" bind={false}>
        <KeyValueFields
          value={action.vars}
          keyLabel="Variable"
          valueLabel="Wert"
          keyPlaceholder="tag"
          valuePlaceholder="${date}"
          addLabel="Variable übergeben"
          onChange={(vars) => onChange({ ...action, vars })}
        />
      </FormRow>
    </div>
  );
}

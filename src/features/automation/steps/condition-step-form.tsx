import { ComparatorSelect } from "../comparator-select";
import { FlowSelect } from "../flow-select";
import { FormRow } from "../form-row";
import { type StepFormProps, useFieldError, useStepForm } from "../step-form-context";
import { TemplateInput } from "../template-input";

export function ConditionStepForm({ action, onChange }: StepFormProps<"condition">) {
  const { siblings, stepId } = useStepForm();
  const leftError = useFieldError("left");
  const thenError = useFieldError("then");
  const otherwiseError = useFieldError("otherwise");
  const unary = action.op === "empty" || action.op === "not_empty";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 @lg/step:grid-cols-2">
        <FormRow label="Wenn" error={leftError} className="@lg/step:col-span-2">
          <TemplateInput
            value={action.left}
            placeholder="${last.rows}"
            mono
            onChange={(left) => onChange({ ...action, left })}
          />
        </FormRow>
        <FormRow label="Vergleich" bind={false}>
          <ComparatorSelect value={action.op} onChange={(op) => onChange({ ...action, op })} />
        </FormRow>
        {!unary && (
          <FormRow label="Wert">
            <TemplateInput
              value={action.right}
              placeholder="0"
              mono
              onChange={(right) => onChange({ ...action, right })}
            />
          </FormRow>
        )}
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        Zahlen werden als Zahlen verglichen, alles andere als Text. „Passt auf Regex“ nutzt reguläre
        Ausdrücke.
      </p>
      <div className="grid gap-4 @lg/step:grid-cols-2">
        <FormRow label="Dann" error={thenError} bind={false}>
          <FlowSelect
            label="Dann"
            value={action.then}
            siblings={siblings}
            currentId={stepId}
            onChange={(then) => onChange({ ...action, then })}
          />
        </FormRow>
        <FormRow label="Sonst" error={otherwiseError} bind={false}>
          <FlowSelect
            label="Sonst"
            value={action.otherwise}
            siblings={siblings}
            currentId={stepId}
            onChange={(otherwise) => onChange({ ...action, otherwise })}
          />
        </FormRow>
      </div>
    </div>
  );
}

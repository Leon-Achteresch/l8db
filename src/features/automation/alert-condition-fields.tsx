import { SegmentedControl } from "@/components/motion/segmented-control";
import type { AlertCondition } from "@/lib/db/automation";
import { ComparatorSelect } from "./comparator-select";
import { FormRow } from "./form-row";
import { optionalText, useFieldError } from "./step-form-context";
import { TemplateInput } from "./template-input";

type ConditionType = AlertCondition["type"];

const OPTIONS: { value: ConditionType; label: string }[] = [
  { value: "has_rows", label: "Zeilen vorhanden" },
  { value: "no_rows", label: "Keine Zeilen" },
  { value: "value", label: "Schwellwert" },
  { value: "error", label: "Abfragefehler" },
];

const HINTS: Record<ConditionType, string> = {
  has_rows: "Löst aus, sobald die Abfrage mindestens eine Zeile liefert.",
  no_rows: "Löst aus, wenn die Abfrage nichts liefert, etwa weil ein Import ausblieb.",
  value: "Vergleicht einen Wert der ersten Zeile mit dem Schwellwert.",
  error: "Löst aus, wenn die Abfrage fehlschlägt.",
};

interface Props {
  value: AlertCondition;
  onChange: (value: AlertCondition) => void;
}

export function AlertConditionFields({ value, onChange }: Props) {
  const thresholdError = useFieldError("condition.threshold");

  return (
    <div className="flex flex-col gap-4">
      <FormRow label="Auslösen bei" hint={HINTS[value.type]} bind={false}>
        <SegmentedControl
          label="Auslösen bei"
          value={value.type}
          options={OPTIONS}
          onChange={(type) =>
            onChange(type === "value" ? { type, column: null, op: "gt", threshold: "" } : { type })
          }
        />
      </FormRow>
      {value.type === "value" && (
        <div className="grid grid-cols-3 gap-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <FormRow label="Spalte" hint="Leer = erste Spalte">
            <TemplateInput
              value={value.column ?? ""}
              placeholder="anzahl"
              mono
              onChange={(column) => onChange({ ...value, column: optionalText(column) })}
            />
          </FormRow>
          <FormRow label="Wert ist" bind={false}>
            <ComparatorSelect value={value.op} onChange={(op) => onChange({ ...value, op })} />
          </FormRow>
          <FormRow label="Schwellwert" error={thresholdError}>
            <TemplateInput
              value={value.threshold}
              placeholder="100"
              onChange={(threshold) => onChange({ ...value, threshold })}
            />
          </FormRow>
        </div>
      )}
    </div>
  );
}

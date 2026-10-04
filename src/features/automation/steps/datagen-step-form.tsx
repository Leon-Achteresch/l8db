import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import type { DatagenLocale } from "@/lib/db/datagen";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { optionalNumber, type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

const LOCALES: { value: DatagenLocale; label: string }[] = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "Englisch" },
];

export function DatagenStepForm({ action, onChange }: StepFormProps<"datagen">) {
  const tableError = useFieldError("table");
  const rowsError = useFieldError("rows");

  return (
    <div className="flex flex-col gap-4">
      <ConnectionFields
        connection={action.connection}
        database={action.database}
        onChange={(next) => onChange({ ...action, ...next })}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Schema">
          <TemplateInput
            value={action.schema}
            placeholder="public"
            mono
            onChange={(schema) => onChange({ ...action, schema })}
          />
        </FormRow>
        <FormRow label="Tabelle" error={tableError}>
          <TemplateInput
            value={action.table}
            placeholder="customers"
            mono
            onChange={(table) => onChange({ ...action, table })}
          />
        </FormRow>
      </div>
      <div className="grid gap-3 @lg/step:grid-cols-3">
        <FormRow label="Zeilen" error={rowsError}>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={action.rows}
            onChange={(event) => onChange({ ...action, rows: Number(event.target.value) || 0 })}
          />
        </FormRow>
        <FormRow label="Startwert" hint="Gleicher Wert = gleiche Daten">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="zufällig"
            value={action.seed ?? ""}
            onChange={(event) => onChange({ ...action, seed: optionalNumber(event.target.value) })}
          />
        </FormRow>
        <FormRow label="Sprache" bind={false}>
          <SegmentedControl
            label="Sprache der Testdaten"
            value={action.locale}
            options={LOCALES}
            onChange={(locale) => onChange({ ...action, locale })}
          />
        </FormRow>
      </div>
      <SwitchRow
        label="In einer Transaktion"
        description="Bei einem Fehler wird nichts eingefügt."
        checked={action.transaction}
        onCheckedChange={(transaction) => onChange({ ...action, transaction })}
      />
    </div>
  );
}

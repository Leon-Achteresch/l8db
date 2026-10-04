import { newOutput } from "@/lib/automation/defaults";
import type { CompareSideConfig } from "@/lib/db/automation";
import { ChipsInput } from "../chips-input";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { OutputSpecFields } from "../output-spec-fields";
import { optionalText, type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

interface SideProps {
  title: string;
  side: "left" | "right";
  value: CompareSideConfig;
  onChange: (value: CompareSideConfig) => void;
}

function useSide(side: "left" | "right") {
  return useFieldError(`${side}.table`);
}

function sideFields({ title, side, value, onChange }: SideProps, tableError: string | null) {
  return (
    <FormSection title={title}>
      <ConnectionFields
        field={`${side}.connection`}
        connection={value.connection}
        database={value.database}
        capability="data_compare"
        onChange={(next) => onChange({ ...value, ...next })}
      />
      <div className="grid gap-3 @lg/step:grid-cols-2">
        <FormRow label="Schema">
          <TemplateInput
            value={value.schema}
            placeholder="public"
            mono
            onChange={(schema) => onChange({ ...value, schema })}
          />
        </FormRow>
        <FormRow label="Tabelle" error={tableError}>
          <TemplateInput
            value={value.table}
            placeholder="orders"
            mono
            onChange={(table) => onChange({ ...value, table })}
          />
        </FormRow>
        <FormRow label="Filter" hint="WHERE-Bedingung, optional" className="@lg/step:col-span-2">
          <TemplateInput
            value={value.filter ?? ""}
            mono
            onChange={(filter) => onChange({ ...value, filter: optionalText(filter) })}
          />
        </FormRow>
      </div>
    </FormSection>
  );
}

export function CompareStepForm({ action, onChange }: StepFormProps<"compare">) {
  const leftTable = useSide("left");
  const rightTable = useSide("right");
  const keysError = useFieldError("keyColumns");

  return (
    <div className="flex flex-col gap-8">
      {sideFields(
        {
          title: "Links",
          side: "left",
          value: action.left,
          onChange: (left) => onChange({ ...action, left }),
        },
        leftTable,
      )}
      {sideFields(
        {
          title: "Rechts",
          side: "right",
          value: action.right,
          onChange: (right) => onChange({ ...action, right }),
        },
        rightTable,
      )}
      <FormSection title="Vergleich">
        <div className="grid gap-4 @lg/step:grid-cols-2">
          <FormRow label="Schlüsselspalten" error={keysError}>
            <ChipsInput
              value={action.keyColumns}
              itemLabel="Spalte"
              mono
              placeholder="id"
              onChange={(keyColumns) => onChange({ ...action, keyColumns })}
            />
          </FormRow>
          <FormRow label="Verglichene Spalten" hint="Leer = alle gemeinsamen Spalten">
            <ChipsInput
              value={action.compareColumns}
              itemLabel="Spalte"
              mono
              onChange={(compareColumns) => onChange({ ...action, compareColumns })}
            />
          </FormRow>
        </div>
        <SwitchRow
          label="Bei Unterschieden fehlschlagen"
          checked={action.failIfDifferent}
          onCheckedChange={(failIfDifferent) => onChange({ ...action, failIfDifferent })}
        />
        <SwitchRow
          label="Bericht als JSON speichern"
          checked={Boolean(action.report)}
          onCheckedChange={(checked) =>
            onChange({
              ...action,
              report: checked ? newOutput("${output_dir}/vergleich.json") : null,
            })
          }
        />
        {action.report && (
          <OutputSpecFields
            field="report"
            value={action.report}
            extension="json"
            allowAppend={false}
            onChange={(report) => onChange({ ...action, report })}
          />
        )}
      </FormSection>
    </div>
  );
}

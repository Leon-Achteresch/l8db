import { SegmentedControl } from "@/components/motion/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VAR_QUERY_MODE_LABELS } from "@/lib/automation/labels";
import type { VarQueryMode } from "@/lib/db/automation";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { SqlTemplateEditor } from "../sql-template-editor";
import { optionalText, type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

const SOURCES = [
  { value: "value", label: "Wert" },
  { value: "query", label: "Aus Abfrage" },
] as const;

export function SetVariableStepForm({ action, onChange }: StepFormProps<"set_variable">) {
  const nameError = useFieldError("name");
  const sqlError = useFieldError("query.sql");
  const query = action.query;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 @lg/step:grid-cols-2">
        <FormRow
          label="Variable"
          error={nameError}
          hint={
            action.name ? (
              <>
                Danach verfügbar als <code className="font-mono">{`\${${action.name}}`}</code>
              </>
            ) : undefined
          }
        >
          <TemplateInput
            value={action.name}
            placeholder="anzahl"
            mono
            onChange={(name) => onChange({ ...action, name })}
          />
        </FormRow>
        <FormRow label="Quelle" bind={false}>
          <SegmentedControl
            label="Quelle des Werts"
            value={query ? "query" : "value"}
            options={SOURCES}
            onChange={(source) =>
              onChange({
                ...action,
                query:
                  source === "query"
                    ? {
                        connection: "",
                        database: null,
                        sql: "",
                        mode: "first_value",
                        separator: null,
                      }
                    : null,
              })
            }
          />
        </FormRow>
      </div>
      {query ? (
        <>
          <ConnectionFields
            field="query.connection"
            connection={query.connection}
            database={query.database}
            onChange={(next) => onChange({ ...action, query: { ...query, ...next } })}
          />
          <FormRow label="Abfrage" error={sqlError}>
            <SqlTemplateEditor
              label="Abfrage für den Wert"
              value={query.sql}
              placeholder="SELECT max(id) FROM orders"
              onChange={(sql) => onChange({ ...action, query: { ...query, sql } })}
            />
          </FormRow>
          <div className="grid gap-4 @lg/step:grid-cols-2">
            <FormRow label="Übernehmen als" bind={false}>
              <Select
                value={query.mode}
                onValueChange={(mode) =>
                  onChange({ ...action, query: { ...query, mode: mode as VarQueryMode } })
                }
              >
                <SelectTrigger aria-label="Übernehmen als" className="w-full rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(VAR_QUERY_MODE_LABELS) as VarQueryMode[]).map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {VAR_QUERY_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            {query.mode === "column_list" && (
              <FormRow label="Trennzeichen" hint="Leer = Komma">
                <TemplateInput
                  value={query.separator ?? ""}
                  placeholder=","
                  mono
                  onChange={(separator) =>
                    onChange({ ...action, query: { ...query, separator: optionalText(separator) } })
                  }
                />
              </FormRow>
            )}
          </div>
        </>
      ) : (
        <>
          <FormRow label="Wert">
            <TemplateInput
              value={action.value}
              placeholder={action.calculate ? "${step.2.rows} * 2" : "${date}-${environment}"}
              mono
              onChange={(value) => onChange({ ...action, value })}
            />
          </FormRow>
          <SwitchRow
            label="Als Rechnung auswerten"
            description="Erlaubt + − × ÷ %, Klammern und Dezimalzahlen nach dem Einsetzen der Platzhalter."
            checked={action.calculate}
            onCheckedChange={(calculate) => onChange({ ...action, calculate })}
          />
        </>
      )}
    </div>
  );
}

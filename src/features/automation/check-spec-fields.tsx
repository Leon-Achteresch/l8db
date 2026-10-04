import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NUMERIC_COMPARATORS } from "@/lib/automation/labels";
import type { CheckSpec } from "@/lib/db/automation";
import { ChipsInput } from "./chips-input";
import { ComparatorSelect } from "./comparator-select";
import { FormRow } from "./form-row";
import { SqlTemplateEditor } from "./sql-template-editor";
import { optionalNumber, optionalText, useFieldError } from "./step-form-context";
import { TemplateInput } from "./template-input";

type CheckType = CheckSpec["type"];

const CHECK_LABELS: Record<CheckType, { label: string; hint: string }> = {
  row_count: {
    label: "Zeilenzahl",
    hint: "Vergleicht die Anzahl der Zeilen einer Tabelle oder Abfrage.",
  },
  value: { label: "Wert", hint: "Vergleicht die erste Zelle einer Abfrage mit einem Sollwert." },
  not_null: {
    label: "Keine leeren Werte",
    hint: "Verstoß, sobald eine Zeile NULL in der Spalte hat.",
  },
  unique: {
    label: "Eindeutig",
    hint: "Verstoß, wenn eine Kombination der Spalten mehrfach vorkommt.",
  },
  accepted_values: { label: "Erlaubte Werte", hint: "Verstoß bei jedem Wert außerhalb der Liste." },
  freshness: {
    label: "Aktualität",
    hint: "Prüft, wie alt der neueste Zeitstempel in einer Spalte ist.",
  },
  query: { label: "Eigene Abfrage", hint: "Jede zurückgegebene Zeile zählt als Verstoß." },
};

function defaults(type: CheckType, from: CheckSpec): CheckSpec {
  const schema = "schema" in from && from.schema ? from.schema : "";
  const table = "table" in from && from.table ? from.table : "";
  switch (type) {
    case "row_count":
      return { type, schema: schema || null, table: table || null, sql: null, op: "gt", value: 0 };
    case "value":
      return { type, sql: "", op: "eq", value: "", tolerance: null };
    case "not_null":
      return { type, schema, table, column: "" };
    case "unique":
      return { type, schema, table, columns: [] };
    case "accepted_values":
      return { type, schema, table, column: "", values: [] };
    case "freshness":
      return { type, schema, table, column: "", warnAfterMinutes: null, errorAfterMinutes: 60 };
    case "query":
      return { type, sql: "" };
  }
}

interface Props {
  value: CheckSpec;
  onChange: (value: CheckSpec) => void;
}

export function CheckSpecFields({ value, onChange }: Props) {
  const tableError = useFieldError("check.table");
  const sqlError = useFieldError("check.sql");
  const columnError = useFieldError("check.column");
  const columnsError = useFieldError("check.columns");
  const valuesError = useFieldError("check.values");
  const errorAfter = useFieldError("check.errorAfterMinutes");

  const tableFields = "table" in value && value.type !== "row_count" && (
    <div className="grid grid-cols-2 gap-3">
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
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <FormRow label="Prüfung" hint={CHECK_LABELS[value.type].hint} bind={false}>
        <Select
          value={value.type}
          onValueChange={(type) => onChange(defaults(type as CheckType, value))}
        >
          <SelectTrigger aria-label="Prüfung" className="w-full rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHECK_LABELS) as CheckType[]).map((type) => (
              <SelectItem key={type} value={type}>
                {CHECK_LABELS[type].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormRow>

      {value.type === "row_count" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Schema">
              <TemplateInput
                value={value.schema ?? ""}
                placeholder="public"
                mono
                onChange={(schema) => onChange({ ...value, schema: optionalText(schema) })}
              />
            </FormRow>
            <FormRow label="Tabelle" error={tableError} hint="Oder unten eine Abfrage.">
              <TemplateInput
                value={value.table ?? ""}
                placeholder="orders"
                mono
                onChange={(table) => onChange({ ...value, table: optionalText(table) })}
              />
            </FormRow>
          </div>
          <FormRow label="Abfrage (statt Tabelle)">
            <SqlTemplateEditor
              label="Abfrage für die Zeilenzahl"
              value={value.sql ?? ""}
              placeholder="SELECT * FROM orders WHERE status = 'open'"
              onChange={(sql) => onChange({ ...value, sql: optionalText(sql) })}
            />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Anzahl muss" bind={false}>
              <ComparatorSelect
                value={value.op}
                options={NUMERIC_COMPARATORS}
                onChange={(op) => onChange({ ...value, op })}
              />
            </FormRow>
            <FormRow label="Wert">
              <Input
                type="number"
                inputMode="decimal"
                value={value.value}
                onChange={(event) => onChange({ ...value, value: Number(event.target.value) || 0 })}
              />
            </FormRow>
          </div>
        </>
      )}

      {value.type === "value" && (
        <>
          <FormRow label="Abfrage" error={sqlError}>
            <SqlTemplateEditor
              label="Abfrage für den Wert"
              value={value.sql}
              placeholder="SELECT SUM(amount) FROM payments WHERE day = '${date}'"
              onChange={(sql) => onChange({ ...value, sql })}
            />
          </FormRow>
          <div className="grid grid-cols-3 gap-3">
            <FormRow label="Wert muss" bind={false}>
              <ComparatorSelect value={value.op} onChange={(op) => onChange({ ...value, op })} />
            </FormRow>
            <FormRow label="Sollwert">
              <TemplateInput
                value={value.value}
                onChange={(next) => onChange({ ...value, value: next })}
              />
            </FormRow>
            <FormRow label="Toleranz" hint="± bei Zahlen">
              <Input
                type="number"
                inputMode="decimal"
                placeholder="keine"
                value={value.tolerance ?? ""}
                onChange={(event) =>
                  onChange({ ...value, tolerance: optionalNumber(event.target.value) })
                }
              />
            </FormRow>
          </div>
        </>
      )}

      {tableFields}

      {(value.type === "not_null" ||
        value.type === "accepted_values" ||
        value.type === "freshness") && (
        <FormRow label="Spalte" error={columnError}>
          <TemplateInput
            value={value.column}
            placeholder={value.type === "freshness" ? "updated_at" : "status"}
            mono
            onChange={(column) => onChange({ ...value, column })}
          />
        </FormRow>
      )}

      {value.type === "unique" && (
        <FormRow label="Spalten" error={columnsError} hint="Enter oder Komma trennt.">
          <ChipsInput
            value={value.columns}
            itemLabel="Spalte"
            mono
            placeholder="id"
            onChange={(columns) => onChange({ ...value, columns })}
          />
        </FormRow>
      )}

      {value.type === "accepted_values" && (
        <FormRow label="Erlaubte Werte" error={valuesError}>
          <ChipsInput
            value={value.values}
            itemLabel="Wert"
            placeholder="open, closed"
            onChange={(values) => onChange({ ...value, values })}
          />
        </FormRow>
      )}

      {value.type === "freshness" && (
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Warnung nach (Min.)">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="keine"
              value={value.warnAfterMinutes ?? ""}
              onChange={(event) =>
                onChange({ ...value, warnAfterMinutes: optionalNumber(event.target.value) })
              }
            />
          </FormRow>
          <FormRow label="Fehler nach (Min.)" error={errorAfter}>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={value.errorAfterMinutes}
              onChange={(event) =>
                onChange({ ...value, errorAfterMinutes: Number(event.target.value) || 0 })
              }
            />
          </FormRow>
        </div>
      )}

      {value.type === "query" && (
        <FormRow
          label="Abfrage"
          error={sqlError}
          hint="Gibt die Abfrage Zeilen zurück, ist die Prüfung verletzt."
        >
          <SqlTemplateEditor
            label="Abfrage, die Verstöße liefert"
            value={value.sql}
            placeholder="SELECT * FROM orders WHERE total < 0"
            onChange={(sql) => onChange({ ...value, sql })}
          />
        </FormRow>
      )}
    </div>
  );
}

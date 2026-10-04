import { ArrowRightIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IMPORT_FORMAT_LABELS } from "@/lib/automation/labels";
import type { ImportFileFormat } from "@/lib/db/automation";
import { ChipsInput } from "../chips-input";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { PathInput } from "../path-input";
import { optionalText, type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

const EXTENSIONS: Record<ImportFileFormat, string[]> = {
  csv: ["csv", "tsv", "txt"],
  json: ["json"],
  ndjson: ["ndjson", "jsonl"],
  xlsx: ["xlsx"],
  parquet: ["parquet"],
};

export function ImportStepForm({ action, onChange }: StepFormProps<"import">) {
  const tableError = useFieldError("table");
  const fileError = useFieldError("file");
  const conflict = action.conflict;

  return (
    <div className="flex flex-col gap-8">
      <FormSection title="Datei">
        <div className="grid gap-4 @lg/step:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          <FormRow label="Datei" error={fileError}>
            <PathInput
              mode="open"
              extensions={EXTENSIONS[action.format]}
              value={action.file}
              placeholder="/pfad/zu/daten.csv"
              onChange={(file) => onChange({ ...action, file })}
            />
          </FormRow>
          <FormRow label="Format" bind={false}>
            <Select
              value={action.format}
              onValueChange={(format) =>
                onChange({ ...action, format: format as ImportFileFormat })
              }
            >
              <SelectTrigger aria-label="Format" className="w-full rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(IMPORT_FORMAT_LABELS) as ImportFileFormat[]).map((format) => (
                  <SelectItem key={format} value={format}>
                    {IMPORT_FORMAT_LABELS[format]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
        </div>
        {action.format === "csv" && (
          <div className="flex flex-wrap items-end gap-6">
            <FormRow label="Trennzeichen" className="w-28">
              <Input
                value={action.delimiter ?? ""}
                placeholder=","
                maxLength={2}
                className="font-mono"
                onChange={(event) =>
                  onChange({ ...action, delimiter: optionalText(event.target.value) })
                }
              />
            </FormRow>
            <SwitchRow
              label="Erste Zeile ist Kopfzeile"
              className="pb-2"
              checked={action.hasHeader}
              onCheckedChange={(hasHeader) => onChange({ ...action, hasHeader })}
            />
          </div>
        )}
        {action.format === "xlsx" && (
          <FormRow label="Blatt" hint="Leer = erstes Blatt" className="max-w-72">
            <TemplateInput
              value={action.sheet ?? ""}
              placeholder="Tabelle1"
              onChange={(sheet) => onChange({ ...action, sheet: optionalText(sheet) })}
            />
          </FormRow>
        )}
      </FormSection>

      <FormSection title="Ziel">
        <ConnectionFields
          connection={action.connection}
          database={action.database}
          capability="csv_import"
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
              placeholder="orders"
              mono
              onChange={(table) => onChange({ ...action, table })}
            />
          </FormRow>
        </div>
        <FormRow
          label="Spaltenzuordnung"
          hint="Leer = Spalten der Datei in derselben Reihenfolge wie in der Tabelle."
          bind={false}
        >
          <div className="flex flex-col gap-1.5">
            {action.columns.map((column, index) => (
              <div
                key={`${index}-${action.columns.length}`}
                className="grid grid-cols-[6rem_auto_minmax(0,1fr)_auto] items-center gap-1.5"
              >
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={column.source + 1}
                  aria-label={`Dateispalte ${index + 1}`}
                  onChange={(event) =>
                    onChange({
                      ...action,
                      columns: action.columns.map((entry, at) =>
                        at === index
                          ? { ...entry, source: Math.max(0, (Number(event.target.value) || 1) - 1) }
                          : entry,
                      ),
                    })
                  }
                />
                <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                <Input
                  value={column.target}
                  placeholder="spalte"
                  aria-label={`Tabellenspalte ${index + 1}`}
                  className="font-mono text-[13px]"
                  onChange={(event) =>
                    onChange({
                      ...action,
                      columns: action.columns.map((entry, at) =>
                        at === index ? { ...entry, target: event.target.value } : entry,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Zuordnung ${index + 1} entfernen`}
                  onClick={() =>
                    onChange({ ...action, columns: action.columns.filter((_, at) => at !== index) })
                  }
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              onClick={() =>
                onChange({
                  ...action,
                  columns: [...action.columns, { source: action.columns.length, target: "" }],
                })
              }
            >
              <PlusIcon />
              Spalte zuordnen
            </Button>
          </div>
        </FormRow>
        <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-3">
          <SwitchRow
            label="Vorhandene Zeilen aktualisieren"
            description="Upsert über einen Unique-Constraint statt Fehler bei Duplikaten."
            checked={Boolean(conflict)}
            onCheckedChange={(checked) =>
              onChange({
                ...action,
                conflict: checked ? { constraint: "", updateColumns: [] } : null,
              })
            }
          />
          {conflict && (
            <div className="grid gap-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none @lg/step:grid-cols-2">
              <FormRow label="Constraint">
                <Input
                  value={conflict.constraint}
                  placeholder="orders_pkey"
                  className="font-mono text-[13px]"
                  onChange={(event) =>
                    onChange({
                      ...action,
                      conflict: { ...conflict, constraint: event.target.value },
                    })
                  }
                />
              </FormRow>
              <FormRow label="Zu aktualisierende Spalten">
                <ChipsInput
                  value={conflict.updateColumns}
                  itemLabel="Spalte"
                  mono
                  onChange={(updateColumns) =>
                    onChange({ ...action, conflict: { ...conflict, updateColumns } })
                  }
                />
              </FormRow>
            </div>
          )}
        </div>
      </FormSection>
    </div>
  );
}

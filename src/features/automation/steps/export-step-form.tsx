import { useId } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_CSV } from "@/lib/automation/defaults";
import { EXPORT_FORMAT_LABELS } from "@/lib/automation/labels";
import type { ExportFormat } from "@/lib/db/automation";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { OutputSpecFields } from "../output-spec-fields";
import { SqlTemplateEditor } from "../sql-template-editor";
import {
  optionalNumber,
  optionalText,
  type StepFormProps,
  useFieldError,
} from "../step-form-context";
import { TemplateInput } from "../template-input";

const SOURCES = [
  { value: "query", label: "Abfrage" },
  { value: "table", label: "Tabelle" },
] as const;

const APPENDABLE = new Set<ExportFormat>(["csv", "tsv", "jsonl", "markdown", "sql"]);
const EXTENSION: Record<ExportFormat, string> = {
  csv: "csv",
  tsv: "tsv",
  json: "json",
  jsonl: "jsonl",
  xlsx: "xlsx",
  xml: "xml",
  html: "html",
  parquet: "parquet",
  markdown: "md",
  sql: "sql",
};

function withExtension(path: string, from: ExportFormat, to: ExportFormat): string {
  const suffix = `.${EXTENSION[from]}`;
  return path.endsWith(suffix) ? `${path.slice(0, -suffix.length)}.${EXTENSION[to]}` : path;
}

export function ExportStepForm({ action, onChange }: StepFormProps<"export">) {
  const headerId = useId();
  const bomId = useId();
  const sqlError = useFieldError("source.sql");
  const tableError = useFieldError("source.table");
  const sheetError = useFieldError("sheetName");
  const source = action.source;
  const isCsv = action.format === "csv" || action.format === "tsv";
  const csv = action.csv ?? DEFAULT_CSV;

  const setFormat = (format: ExportFormat) =>
    onChange({
      ...action,
      format,
      csv: format === "csv" || format === "tsv" ? (action.csv ?? { ...DEFAULT_CSV }) : null,
      sheetName: format === "xlsx" ? action.sheetName : null,
      output: {
        ...action.output,
        path: withExtension(action.output.path, action.format, format),
        ifExists:
          action.output.ifExists === "append" && !APPENDABLE.has(format)
            ? "rename"
            : action.output.ifExists,
      },
    });

  return (
    <div className="flex flex-col gap-8">
      <FormSection title="Quelle">
        <ConnectionFields
          connection={action.connection}
          database={action.database}
          onChange={(next) => onChange({ ...action, ...next })}
        />
        <FormRow
          label="Daten aus"
          bind={false}
          aside={
            <div className="w-48">
              <SegmentedControl
                label="Daten aus"
                value={source.type}
                options={SOURCES}
                onChange={(type) =>
                  onChange({
                    ...action,
                    source:
                      type === "query"
                        ? { type, sql: "" }
                        : { type, schema: "", table: "", filter: null },
                  })
                }
              />
            </div>
          }
        >
          {source.type === "query" ? (
            <div className="flex flex-col gap-1.5">
              <SqlTemplateEditor
                label="Abfrage für den Export"
                value={source.sql}
                aria-invalid={Boolean(sqlError)}
                placeholder="SELECT * FROM orders WHERE created_at >= '${date-1d}'"
                onChange={(sql) => onChange({ ...action, source: { ...source, sql } })}
              />
              {sqlError && <p className="text-xs text-destructive">{sqlError}</p>}
            </div>
          ) : (
            <div className="grid gap-3 @lg/step:grid-cols-3">
              <FormRow label="Schema">
                <TemplateInput
                  value={source.schema}
                  placeholder="public"
                  mono
                  onChange={(schema) => onChange({ ...action, source: { ...source, schema } })}
                />
              </FormRow>
              <FormRow label="Tabelle" error={tableError}>
                <TemplateInput
                  value={source.table}
                  placeholder="orders"
                  mono
                  onChange={(table) => onChange({ ...action, source: { ...source, table } })}
                />
              </FormRow>
              <FormRow label="Filter" hint="WHERE-Bedingung, optional">
                <TemplateInput
                  value={source.filter ?? ""}
                  placeholder="status = 'open'"
                  mono
                  onChange={(filter) =>
                    onChange({ ...action, source: { ...source, filter: optionalText(filter) } })
                  }
                />
              </FormRow>
            </div>
          )}
        </FormRow>
      </FormSection>

      <FormSection title="Format">
        <div className="grid gap-4 @lg/step:grid-cols-2">
          <FormRow label="Dateiformat" bind={false}>
            <Select
              value={action.format}
              onValueChange={(format) => setFormat(format as ExportFormat)}
            >
              <SelectTrigger aria-label="Dateiformat" className="w-full rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPORT_FORMAT_LABELS) as ExportFormat[]).map((format) => (
                  <SelectItem key={format} value={format}>
                    {EXPORT_FORMAT_LABELS[format]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Höchstens Zeilen" hint="Leer = bis 1 000 000">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="1 000 000"
              value={action.maxRows ?? ""}
              onChange={(event) =>
                onChange({ ...action, maxRows: optionalNumber(event.target.value) })
              }
            />
          </FormRow>
        </div>
        {action.format === "xlsx" && (
          <FormRow label="Blattname" error={sheetError} className="max-w-72">
            <TemplateInput
              value={action.sheetName ?? ""}
              placeholder="Daten"
              maxLength={31}
              onChange={(sheetName) => onChange({ ...action, sheetName: optionalText(sheetName) })}
            />
          </FormRow>
        )}
        {action.format === "sql" && (
          <FormRow label="Zieltabelle der INSERTs" className="max-w-72">
            <TemplateInput
              value={action.sheetName ?? ""}
              placeholder="export"
              mono
              onChange={(sheetName) => onChange({ ...action, sheetName: optionalText(sheetName) })}
            />
          </FormRow>
        )}
        {isCsv && (
          <div className="grid gap-3 rounded-xl bg-muted/50 p-3 @lg/step:grid-cols-4">
            {action.format === "csv" && (
              <FormRow label="Trennzeichen">
                <Input
                  value={csv.delimiter}
                  maxLength={1}
                  className="font-mono"
                  onChange={(event) =>
                    onChange({ ...action, csv: { ...csv, delimiter: event.target.value } })
                  }
                />
              </FormRow>
            )}
            <FormRow label="NULL als">
              <Input
                value={csv.nullText}
                placeholder="leer"
                className="font-mono"
                onChange={(event) =>
                  onChange({ ...action, csv: { ...csv, nullText: event.target.value } })
                }
              />
            </FormRow>
            <FormRow label="Zeilenende" bind={false}>
              <Select
                value={csv.lineEnding}
                onValueChange={(lineEnding) => onChange({ ...action, csv: { ...csv, lineEnding } })}
              >
                <SelectTrigger aria-label="Zeilenende" className="w-full rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={"\n"}>LF (macOS, Linux)</SelectItem>
                  <SelectItem value={"\r\n"}>CRLF (Windows)</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <div className="flex items-center gap-2">
                <Switch
                  id={headerId}
                  size="sm"
                  checked={csv.header}
                  onCheckedChange={(header) => onChange({ ...action, csv: { ...csv, header } })}
                />
                <Label htmlFor={headerId} className="text-xs font-normal">
                  Kopfzeile
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={bomId}
                  size="sm"
                  checked={csv.bom}
                  onCheckedChange={(bom) => onChange({ ...action, csv: { ...csv, bom } })}
                />
                <Label htmlFor={bomId} className="text-xs font-normal">
                  BOM für Excel
                </Label>
              </div>
            </div>
          </div>
        )}
      </FormSection>

      <FormSection title="Ziel">
        <OutputSpecFields
          value={action.output}
          extension={EXTENSION[action.format]}
          allowAppend={APPENDABLE.has(action.format)}
          onChange={(output) => onChange({ ...action, output })}
        />
      </FormSection>
    </div>
  );
}

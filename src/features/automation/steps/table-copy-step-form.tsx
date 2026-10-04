import { ArrowRightIcon, PlusIcon, XIcon } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CopyModeConfig, TableCopyItem } from "@/lib/db/automation";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";

const MODES: { value: CopyModeConfig; label: string }[] = [
  { value: "truncate", label: "Leeren und füllen" },
  { value: "append", label: "Anhängen" },
  { value: "create", label: "Neu anlegen" },
];

const MODE_HINT: Record<CopyModeConfig, string> = {
  truncate: "Leert die Zieltabelle bei jedem Lauf und kopiert alle Zeilen neu.",
  append: "Hängt die Zeilen an die vorhandenen an.",
  create: "Legt die Zieltabelle an; schlägt fehl, wenn sie schon existiert.",
};

export function TableCopyStepForm({ action, onChange }: StepFormProps<"table_copy">) {
  const tablesError = useFieldError("tables");
  const setItem = (index: number, patch: Partial<TableCopyItem>) =>
    onChange({
      ...action,
      tables: action.tables.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    });

  return (
    <div className="flex flex-col gap-8">
      <FormSection title="Quelle und Ziel">
        <ConnectionFields
          label="Quelle"
          field="source"
          connection={action.source}
          database={action.sourceDatabase}
          onChange={(next) =>
            onChange({ ...action, source: next.connection, sourceDatabase: next.database })
          }
        />
        <ConnectionFields
          label="Ziel"
          field="target"
          connection={action.target}
          database={action.targetDatabase}
          capability="table_copy"
          onChange={(next) =>
            onChange({ ...action, target: next.connection, targetDatabase: next.database })
          }
        />
      </FormSection>
      <FormSection title="Tabellen">
        <FormRow label="Quelle → Ziel" error={tablesError} hint="Schema.Tabelle" bind={false}>
          <div className="flex flex-col gap-1.5">
            {action.tables.length > 0 && (
              <div
                aria-hidden
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-1 px-0.5 text-[11px] font-medium text-muted-foreground"
              >
                <span>Schema</span>
                <span>Tabelle</span>
                <span className="mx-0.5 w-3.5" />
                <span>Zielschema</span>
                <span>Zieltabelle</span>
                <span className="w-9" />
              </div>
            )}
            {action.tables.map((item, index) => (
              <div
                key={`${index}-${action.tables.length}`}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-1"
              >
                <Input
                  value={item.schema}
                  placeholder="public"
                  aria-label={`Quellschema ${index + 1}`}
                  className="font-mono text-[13px]"
                  onChange={(event) =>
                    setItem(index, {
                      schema: event.target.value,
                      targetSchema:
                        item.targetSchema === item.schema ? event.target.value : item.targetSchema,
                    })
                  }
                />
                <Input
                  value={item.table}
                  placeholder="orders"
                  aria-label={`Quelltabelle ${index + 1}`}
                  className="font-mono text-[13px]"
                  onChange={(event) =>
                    setItem(index, {
                      table: event.target.value,
                      targetTable:
                        item.targetTable === item.table ? event.target.value : item.targetTable,
                    })
                  }
                />
                <ArrowRightIcon className="mx-0.5 size-3.5 text-muted-foreground" aria-hidden />
                <Input
                  value={item.targetSchema}
                  placeholder="public"
                  aria-label={`Zielschema ${index + 1}`}
                  className="font-mono text-[13px]"
                  onChange={(event) => setItem(index, { targetSchema: event.target.value })}
                />
                <Input
                  value={item.targetTable}
                  placeholder="orders"
                  aria-label={`Zieltabelle ${index + 1}`}
                  className="font-mono text-[13px]"
                  onChange={(event) => setItem(index, { targetTable: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Tabelle ${index + 1} entfernen`}
                  onClick={() =>
                    onChange({ ...action, tables: action.tables.filter((_, at) => at !== index) })
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
                  tables: [
                    ...action.tables,
                    { schema: "", table: "", targetSchema: "", targetTable: "" },
                  ],
                })
              }
            >
              <PlusIcon />
              Tabelle hinzufügen
            </Button>
          </div>
        </FormRow>
        <FormRow label="Modus" hint={MODE_HINT[action.mode]} bind={false}>
          <SegmentedControl
            label="Modus"
            value={action.mode}
            options={MODES}
            onChange={(mode) => onChange({ ...action, mode })}
          />
        </FormRow>
        <div className="flex flex-col gap-3">
          <SwitchRow
            label="Primärschlüssel übernehmen"
            checked={action.includePrimaryKey}
            onCheckedChange={(includePrimaryKey) => onChange({ ...action, includePrimaryKey })}
          />
          <SwitchRow
            label="Indizes übernehmen"
            checked={action.includeIndexes}
            onCheckedChange={(includeIndexes) => onChange({ ...action, includeIndexes })}
          />
        </div>
      </FormSection>
    </div>
  );
}

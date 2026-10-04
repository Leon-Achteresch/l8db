import { ArrowRightIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectionFields } from "../connection-fields";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { type StepFormProps, useFieldError } from "../step-form-context";
import { SwitchRow } from "../switch-row";

export function TransferStepForm({ action, onChange }: StepFormProps<"transfer">) {
  const schemasError = useFieldError("schemas");
  const setPair = (index: number, patch: Partial<{ source: string; target: string }>) =>
    onChange({
      ...action,
      schemas: action.schemas.map((pair, at) => (at === index ? { ...pair, ...patch } : pair)),
    });

  return (
    <div className="flex flex-col gap-8">
      <FormSection
        title="Quelle und Ziel"
        description="Überträgt Struktur und Daten. Existieren Zieltabellen bereits, bricht der Schritt ab, ohne etwas zu ändern."
      >
        <ConnectionFields
          label="Quelle"
          field="source"
          connection={action.source}
          database={action.sourceDatabase}
          capability="table_copy"
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
      <FormSection title="Schemas">
        <FormRow label="Schema-Zuordnung" error={schemasError} bind={false}>
          <div className="flex flex-col gap-1.5">
            {action.schemas.map((pair, index) => (
              <div
                key={`${index}-${action.schemas.length}`}
                className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1.5"
              >
                <Input
                  value={pair.source}
                  placeholder="public"
                  aria-label={`Quellschema ${index + 1}`}
                  className="font-mono text-[13px]"
                  onChange={(event) =>
                    setPair(index, {
                      source: event.target.value,
                      target: pair.target === pair.source ? event.target.value : pair.target,
                    })
                  }
                />
                <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                <Input
                  value={pair.target}
                  placeholder="public"
                  aria-label={`Zielschema ${index + 1}`}
                  className="font-mono text-[13px]"
                  onChange={(event) => setPair(index, { target: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Schema ${index + 1} entfernen`}
                  onClick={() =>
                    onChange({ ...action, schemas: action.schemas.filter((_, at) => at !== index) })
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
                onChange({ ...action, schemas: [...action.schemas, { source: "", target: "" }] })
              }
            >
              <PlusIcon />
              Schema hinzufügen
            </Button>
          </div>
        </FormRow>
        <SwitchRow
          label="Namen an die Konvention des Ziels anpassen"
          description="Etwa Großschreibung bei Oracle. Nur bei unterschiedlichen Datenbankfamilien relevant."
          checked={action.foldNames}
          onCheckedChange={(foldNames) => onChange({ ...action, foldNames })}
        />
      </FormSection>
    </div>
  );
}

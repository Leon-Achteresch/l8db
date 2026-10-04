import { PlusIcon, XIcon } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LoopSource } from "@/lib/db/automation";
import { ConnectionFields } from "../connection-fields";
import { ConnectionPicker } from "../connection-picker";
import { FormRow } from "../form-row";
import { FormSection } from "../form-section";
import { PathInput } from "../path-input";
import { SqlTemplateEditor } from "../sql-template-editor";
import {
  optionalNumber,
  optionalText,
  type StepFormProps,
  useFieldError,
  useFieldWarning,
} from "../step-form-context";
import { SwitchRow } from "../switch-row";
import { TemplateInput } from "../template-input";

type SourceType = LoopSource["type"];

const SOURCES: { value: SourceType; label: string }[] = [
  { value: "query", label: "Zeilen" },
  { value: "connections", label: "Verbindungen" },
  { value: "list", label: "Liste" },
  { value: "files", label: "Dateien" },
];

const ITEM_HINT: Record<SourceType, (item: string) => string> = {
  query: (item) => `\${${item}.spalte} für jede Spalte, \${${item}.index} für die Nummer`,
  connections: (item) => `\${${item}} ist die Verbindung, z. B. in einem SQL-Schritt`,
  list: (item) => `\${${item}} ist der aktuelle Wert`,
  files: (item) => `\${${item}} ist der Pfad der Datei`,
};

function emptySource(type: SourceType): LoopSource {
  switch (type) {
    case "query":
      return { type, connection: "", database: null, sql: "" };
    case "connections":
      return { type, connections: [], tag: null };
    case "list":
      return { type, values: "" };
    case "files":
      return { type, dir: "", pattern: "*" };
  }
}

export function LoopStepForm({ action, onChange }: StepFormProps<"loop">) {
  const sqlError = useFieldError("over.sql");
  const valuesError = useFieldError("over.values");
  const dirError = useFieldError("over.dir");
  const connectionsError = useFieldError("over.connections");
  const itemError = useFieldError("item");
  const emptyWarning = useFieldWarning("steps");
  const over = action.over;
  const setOver = (next: LoopSource) => onChange({ ...action, over: next });

  return (
    <div className="flex flex-col gap-8">
      <FormSection title="Wiederholen für">
        <SegmentedControl
          label="Wiederholen für"
          value={over.type}
          options={SOURCES}
          onChange={(type) => type !== over.type && setOver(emptySource(type))}
        />
        {over.type === "query" && (
          <>
            <ConnectionFields
              field="over.connection"
              connection={over.connection}
              database={over.database}
              onChange={(next) => setOver({ ...over, ...next })}
            />
            <FormRow label="Abfrage" error={sqlError} hint="Höchstens 10 000 Zeilen.">
              <SqlTemplateEditor
                label="Abfrage der Schleife"
                value={over.sql}
                placeholder="SELECT id, email FROM customers WHERE newsletter"
                onChange={(sql) => setOver({ ...over, sql })}
              />
            </FormRow>
          </>
        )}
        {over.type === "connections" && (
          <>
            <FormRow label="Alle Verbindungen mit Tag" className="max-w-72">
              <TemplateInput
                value={over.tag ?? ""}
                placeholder="produktion"
                onChange={(tag) => setOver({ ...over, tag: optionalText(tag) })}
              />
            </FormRow>
            <FormRow label="Und diese Verbindungen" error={connectionsError} bind={false}>
              <div className="flex flex-col gap-1.5">
                {over.connections.map((connection, index) => (
                  <div key={`${index}-${over.connections.length}`} className="flex min-w-0 gap-1.5">
                    <div className="min-w-0 flex-1">
                      <ConnectionPicker
                        value={connection}
                        label={`Verbindung ${index + 1}`}
                        testable={false}
                        onChange={(value) =>
                          setOver({
                            ...over,
                            connections: over.connections.map((entry, at) =>
                              at === index ? value : entry,
                            ),
                          })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Verbindung ${index + 1} entfernen`}
                      onClick={() =>
                        setOver({
                          ...over,
                          connections: over.connections.filter((_, at) => at !== index),
                        })
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
                  onClick={() => setOver({ ...over, connections: [...over.connections, ""] })}
                >
                  <PlusIcon />
                  Verbindung hinzufügen
                </Button>
              </div>
            </FormRow>
          </>
        )}
        {over.type === "list" && (
          <FormRow
            label="Werte"
            error={valuesError}
            hint="Ein Wert pro Zeile oder durch Kommas getrennt."
          >
            <TemplateInput
              multiline
              rows={4}
              mono
              value={over.values}
              placeholder={"berlin\nhamburg\nmünchen"}
              onChange={(values) => setOver({ ...over, values })}
            />
          </FormRow>
        )}
        {over.type === "files" && (
          <div className="grid gap-4 @lg/step:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
            <FormRow label="Ordner" error={dirError}>
              <PathInput
                mode="directory"
                value={over.dir}
                placeholder="/import/eingang"
                onChange={(dir) => setOver({ ...over, dir })}
              />
            </FormRow>
            <FormRow label="Muster">
              <TemplateInput
                value={over.pattern}
                placeholder="*.csv"
                mono
                onChange={(pattern) => setOver({ ...over, pattern })}
              />
            </FormRow>
          </div>
        )}
      </FormSection>
      <FormSection
        title="Element"
        description={
          emptyWarning
            ? "Noch leer. Füge links unter der Schleife Schritte hinzu; sie laufen für jedes Element."
            : `${action.steps.length} ${action.steps.length === 1 ? "Schritt läuft" : "Schritte laufen"} für jedes Element. Du bearbeitest sie links, eingerückt unter der Schleife.`
        }
      >
        <div className="grid gap-4 @lg/step:grid-cols-2">
          <FormRow
            label="Name des Elements"
            error={itemError}
            hint={ITEM_HINT[over.type](action.item || "item")}
          >
            <TemplateInput
              value={action.item}
              placeholder="item"
              mono
              onChange={(item) => onChange({ ...action, item })}
            />
          </FormRow>
          <FormRow label="Höchstens Durchläufe" hint="Leer = 10 000">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="10 000"
              value={action.maxIterations ?? ""}
              onChange={(event) =>
                onChange({ ...action, maxIterations: optionalNumber(event.target.value) })
              }
            />
          </FormRow>
        </div>
        <SwitchRow
          label="Bei Fehler mit dem nächsten Element weitermachen"
          description="Sonst beendet der erste Fehler die ganze Schleife."
          checked={action.continueOnError}
          onCheckedChange={(continueOnError) => onChange({ ...action, continueOnError })}
        />
      </FormSection>
    </div>
  );
}

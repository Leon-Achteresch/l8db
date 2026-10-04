import { PlusIcon, XIcon } from "lucide-react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { ConnectionPicker } from "../connection-picker";
import { FormRow } from "../form-row";
import { PathInput } from "../path-input";
import { SqlTemplateEditor } from "../sql-template-editor";
import { optionalText, type StepFormProps, useFieldError } from "../step-form-context";
import { TemplateInput } from "../template-input";

const SOURCES = [
  { value: "inline", label: "SQL" },
  { value: "file", label: "Aus Datei" },
] as const;

export function SqlStepForm({ action, onChange }: StepFormProps<"sql">) {
  const connectionsError = useFieldError("connections");
  const sqlError = useFieldError("sql");
  const connections = action.connections.length ? action.connections : [""];
  const fromFile = action.file !== null;
  const setConnection = (index: number, value: string) => {
    const next = [...connections];
    next[index] = value;
    onChange({ ...action, connections: next.filter((entry, at) => entry || at === 0) });
  };

  return (
    <div className="flex flex-col gap-4">
      <FormRow
        label={connections.length > 1 ? "Verbindungen" : "Verbindung"}
        error={connectionsError}
        hint={connections.length > 1 ? "Läuft nacheinander auf jeder Verbindung." : undefined}
        bind={false}
      >
        <div className="flex flex-col gap-1.5">
          {connections.map((connection, index) => (
            <div
              key={`${index}-${connections.length}`}
              className="flex min-w-0 items-start gap-1.5"
            >
              <div className="min-w-0 flex-1">
                <ConnectionPicker
                  value={connection}
                  label={`Verbindung ${index + 1}`}
                  aria-invalid={Boolean(connectionsError) && !connection}
                  onChange={(value) => setConnection(index, value)}
                />
              </div>
              {connections.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Verbindung ${index + 1} entfernen`}
                  onClick={() =>
                    onChange({
                      ...action,
                      connections: connections.filter((_, at) => at !== index),
                    })
                  }
                >
                  <XIcon />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            onClick={() => onChange({ ...action, connections: [...connections, ""] })}
          >
            <PlusIcon />
            Weitere Verbindung
          </Button>
        </div>
      </FormRow>
      <FormRow label="Datenbank" hint="Leer = Standard der Verbindung" className="max-w-72">
        <TemplateInput
          value={action.database ?? ""}
          placeholder="Standard"
          mono
          onChange={(database) => onChange({ ...action, database: optionalText(database) })}
        />
      </FormRow>
      <FormRow
        label="Skript"
        error={sqlError}
        bind={false}
        aside={
          <div className="w-44">
            <SegmentedControl
              label="Quelle des Skripts"
              value={fromFile ? "file" : "inline"}
              options={SOURCES}
              onChange={(source) => onChange({ ...action, file: source === "file" ? "" : null })}
            />
          </div>
        }
      >
        {fromFile ? (
          <PathInput
            mode="open"
            extensions={["sql"]}
            aria-label="SQL-Datei"
            value={action.file ?? ""}
            placeholder="/pfad/zu/skript.sql"
            onChange={(file) => onChange({ ...action, file })}
          />
        ) : (
          <SqlTemplateEditor
            label="SQL-Skript"
            value={action.sql}
            aria-invalid={Boolean(sqlError)}
            placeholder="UPDATE orders SET archived = true WHERE created_at < '${date-90d}';"
            onChange={(sql) => onChange({ ...action, sql })}
          />
        )}
      </FormRow>
    </div>
  );
}

import { type ConnectionCapability, ConnectionPicker } from "./connection-picker";
import { FormRow } from "./form-row";
import { optionalText, useFieldError } from "./step-form-context";
import { TemplateInput } from "./template-input";

interface Props {
  connection: string;
  database: string | null;
  onChange: (value: { connection: string; database: string | null }) => void;
  capability?: ConnectionCapability;
  label?: string;
  field?: string;
}

export function ConnectionFields({
  connection,
  database,
  onChange,
  capability,
  label = "Verbindung",
  field = "connection",
}: Props) {
  const error = useFieldError(field);

  return (
    <div className="grid gap-4 @lg/step:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <FormRow label={label} error={error}>
        <ConnectionPicker
          value={connection}
          capability={capability}
          label={label}
          onChange={(next) => onChange({ connection: next, database })}
        />
      </FormRow>
      <FormRow label="Datenbank" hint="Leer = Standard der Verbindung">
        <TemplateInput
          value={database ?? ""}
          placeholder="Standard"
          mono
          onChange={(next) => onChange({ connection, database: optionalText(next) })}
        />
      </FormRow>
    </div>
  );
}

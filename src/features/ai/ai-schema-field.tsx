import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  name: string;
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  required: boolean;
  disabled: boolean;
}
export function AiSchemaField({ name, schema, value, onChange, required, disabled }: Props) {
  const id = useId();
  const label = String(schema.title ?? name);
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  if (schema.type === "object" && Object.keys(properties).length)
    return (
      <fieldset className="space-y-3 rounded-lg bg-muted/30 p-3">
        <legend className="px-1 text-xs font-medium">{label}</legend>
        {Object.entries(properties).map(([key, child]) => (
          <AiSchemaField
            key={key}
            name={key}
            schema={child}
            required={Array.isArray(schema.required) && schema.required.includes(key)}
            disabled={disabled}
            value={
              value && typeof value === "object"
                ? (value as Record<string, unknown>)[key]
                : undefined
            }
            onChange={(next) =>
              onChange({ ...(value && typeof value === "object" ? value : {}), [key]: next })
            }
          />
        ))}
      </fieldset>
    );
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
        {required ? " *" : ""}
      </label>
      {Boolean(schema.description) && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {String(schema.description)}
        </p>
      )}
      {Array.isArray(schema.enum) ? (
        <fieldset className="flex flex-wrap gap-2" aria-label={label}>
          {schema.enum.map((choice, index) => (
            <Button
              key={String(choice)}
              size="sm"
              variant={value === choice ? "secondary" : "outline"}
              disabled={disabled}
              onClick={() => onChange(choice)}
              aria-pressed={value === choice}
            >
              {String(Array.isArray(schema.enumNames) ? schema.enumNames[index] : choice)}
            </Button>
          ))}
        </fieldset>
      ) : schema.type === "boolean" ? (
        <label className="flex min-h-8 items-center gap-2 text-xs">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{value ? "Ja" : "Nein"}</span>
        </label>
      ) : schema.type === "array" ? (
        <textarea
          id={id}
          disabled={disabled}
          aria-label={label}
          className="min-h-20 w-full rounded-md border bg-background p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Ein Wert pro Zeile"
          value={Array.isArray(value) ? value.join("\n") : ""}
          onChange={(event) => onChange(event.target.value.split("\n").filter(Boolean))}
        />
      ) : (
        <Input
          id={id}
          disabled={disabled}
          type={schema.type === "number" || schema.type === "integer" ? "number" : "text"}
          min={typeof schema.minimum === "number" ? schema.minimum : undefined}
          max={typeof schema.maximum === "number" ? schema.maximum : undefined}
          placeholder={typeof schema.default === "string" ? schema.default : undefined}
          value={typeof value === "string" || typeof value === "number" ? value : ""}
          onChange={(event) =>
            onChange(
              schema.type === "number" || schema.type === "integer"
                ? event.target.value === ""
                  ? undefined
                  : Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
    </div>
  );
}

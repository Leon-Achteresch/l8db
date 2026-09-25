import { Input } from "@/components/ui/input";
import type { DatagenGenerator } from "@/lib/db";

interface Props {
  name: string;
  generator: DatagenGenerator;
  onChange: (generator: DatagenGenerator) => void;
}

function numberValue(text: string, fallback: number): number {
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}

export function DatagenGeneratorParams({ name, generator, onChange }: Props) {
  const field = (
    label: string,
    value: string | number,
    apply: (text: string) => void,
    hint?: string,
  ) => (
    <div className="flex min-w-0 flex-1 items-center gap-1.5" title={hint}>
      <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <Input
        className="h-7 min-w-0 flex-1 font-mono text-xs"
        aria-label={`${label} ${name}`}
        value={value}
        onChange={(event) => apply(event.target.value)}
      />
    </div>
  );
  switch (generator.kind) {
    case "fixed":
      return field("Wert", generator.value, (value) => onChange({ ...generator, value }));
    case "list":
      return field("Werte (kommagetrennt)", generator.values.join(", "), (text) =>
        onChange({
          ...generator,
          values: text
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        }),
      );
    case "pattern":
      return field(
        "Muster",
        generator.pattern,
        (pattern) => onChange({ ...generator, pattern }),
        "# Ziffer · ? Großbuchstabe · @ Kleinbuchstabe · * Buchstabe/Ziffer · % Zeilennummer",
      );
    case "sql":
      return field("SQL-Ausdruck", generator.expression, (expression) =>
        onChange({ ...generator, expression }),
      );
    case "sequence":
      return (
        <>
          {field("Start", generator.start, (text) =>
            onChange({ ...generator, start: numberValue(text, generator.start) }),
          )}
          {field("Schritt", generator.step, (text) =>
            onChange({ ...generator, step: numberValue(text, generator.step) }),
          )}
        </>
      );
    case "integer":
    case "lorem":
      return (
        <>
          {field(generator.kind === "lorem" ? "Länge von" : "von", generator.min, (text) =>
            onChange({ ...generator, min: numberValue(text, generator.min) }),
          )}
          {field("bis", generator.max, (text) =>
            onChange({ ...generator, max: numberValue(text, generator.max) }),
          )}
        </>
      );
    case "decimal":
      return (
        <>
          {field("von", generator.min, (text) =>
            onChange({ ...generator, min: numberValue(text, generator.min) }),
          )}
          {field("bis", generator.max, (text) =>
            onChange({ ...generator, max: numberValue(text, generator.max) }),
          )}
          {field("Nachkommastellen", generator.scale, (text) =>
            onChange({ ...generator, scale: Math.max(0, Math.round(numberValue(text, 2))) }),
          )}
        </>
      );
    case "date":
    case "timestamp":
      return (
        <>
          {field("von", generator.from, (from) => onChange({ ...generator, from }))}
          {field("bis", generator.to, (to) => onChange({ ...generator, to }))}
        </>
      );
    case "reference":
      return (
        <span className="truncate text-xs text-muted-foreground">
          Werte aus{" "}
          <span className="font-mono">
            {[generator.schema, generator.table, generator.column].filter(Boolean).join(".")}
          </span>
        </span>
      );
    default:
      return null;
  }
}

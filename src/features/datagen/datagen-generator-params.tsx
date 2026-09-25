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
  const field = (label: string, value: string | number, apply: (text: string) => void) => (
    <Input
      className="h-7 min-w-0 flex-1 font-mono text-xs"
      aria-label={`${label} ${name}`}
      placeholder={label}
      value={value}
      onChange={(event) => apply(event.target.value)}
    />
  );
  switch (generator.kind) {
    case "fixed":
      return field("Wert", generator.value, (value) => onChange({ ...generator, value }));
    case "list":
      return field("Werte, kommagetrennt", generator.values.join(", "), (text) =>
        onChange({
          ...generator,
          values: text
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        }),
      );
    case "pattern":
      return field("Muster # ? @ * %", generator.pattern, (pattern) =>
        onChange({ ...generator, pattern }),
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
          {field(generator.kind === "lorem" ? "Min. Zeichen" : "Min", generator.min, (text) =>
            onChange({ ...generator, min: numberValue(text, generator.min) }),
          )}
          {field(generator.kind === "lorem" ? "Max. Zeichen" : "Max", generator.max, (text) =>
            onChange({ ...generator, max: numberValue(text, generator.max) }),
          )}
        </>
      );
    case "decimal":
      return (
        <>
          {field("Min", generator.min, (text) =>
            onChange({ ...generator, min: numberValue(text, generator.min) }),
          )}
          {field("Max", generator.max, (text) =>
            onChange({ ...generator, max: numberValue(text, generator.max) }),
          )}
          {field("Stellen", generator.scale, (text) =>
            onChange({ ...generator, scale: Math.max(0, Math.round(numberValue(text, 2))) }),
          )}
        </>
      );
    case "date":
    case "timestamp":
      return (
        <>
          {field("Von", generator.from, (from) => onChange({ ...generator, from }))}
          {field("Bis", generator.to, (to) => onChange({ ...generator, to }))}
        </>
      );
    case "reference":
      return (
        <span className="truncate font-mono text-xs text-muted-foreground">
          {[generator.schema, generator.table, generator.column].filter(Boolean).join(".")}
        </span>
      );
    default:
      return null;
  }
}

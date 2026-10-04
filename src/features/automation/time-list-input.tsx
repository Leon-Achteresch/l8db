import { timeError } from "@/lib/automation/validation";
import { ChipsInput } from "./chips-input";

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

function normalizeTime(raw: string): string {
  const text = raw
    .trim()
    .replace(/\s*uhr$/i, "")
    .replace(".", ":");
  if (/^\d{1,2}$/.test(text)) return `${text.padStart(2, "0")}:00`;
  if (/^\d{3,4}$/.test(text)) {
    const padded = text.padStart(4, "0");
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : text;
}

export function TimeListInput({ value, onChange, ...input }: Props) {
  return (
    <ChipsInput
      {...input}
      value={value}
      onChange={(next) => onChange([...next].sort())}
      normalize={normalizeTime}
      validate={timeError}
      separators={/[,;\s]+/}
      itemLabel="Uhrzeit"
      placeholder="z. B. 06:00, 18:30"
      mono
      inputMode="numeric"
    />
  );
}

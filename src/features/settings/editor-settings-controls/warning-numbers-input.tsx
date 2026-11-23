import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Row } from "./row";

const parseNumbers = (text: string) => [...new Set((text.match(/\d+/g) ?? []).map(Number))];

export function WarningNumbersInput({
  settingId,
  compact,
  value,
  placeholder,
  label,
  onCommit,
}: {
  settingId: string;
  compact: boolean;
  value: number[];
  placeholder: string;
  label: string;
  onCommit: (numbers: number[]) => void;
}) {
  const [text, setText] = useState(() => value.join(", "));
  useEffect(() => {
    setText(value.join(", "));
  }, [value]);
  const commit = () => {
    const numbers = parseNumbers(text);
    if (numbers.join() !== value.join()) onCommit(numbers);
    else setText(value.join(", "));
  };
  return (
    <Row settingId={settingId} compact={compact}>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 w-28 font-mono text-xs"
      />
    </Row>
  );
}

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseNameList } from "@/lib/backup";

interface BackupNameListInputProps {
  id: string;
  label: string;
  placeholder: string;
  value: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}

export function BackupNameListInput({
  id,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: BackupNameListInputProps) {
  const [text, setText] = useState(value.join(", "));
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        className="h-8 font-mono text-xs"
        onChange={(event) => {
          setText(event.target.value);
          onChange(parseNameList(event.target.value));
        }}
      />
    </div>
  );
}

import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { parseNameList } from "@/lib/backup";

interface BackupNameListInputProps {
  id: string;
  label: string;
  placeholder: string;
  value: string[];
  suggestions?: string[];
  icon?: LucideIcon;
  disabled?: boolean;
  onChange: (value: string[]) => void;
}

export function BackupNameListInput({
  id,
  label,
  placeholder,
  value,
  suggestions = [],
  icon: Icon,
  disabled,
  onChange,
}: BackupNameListInputProps) {
  const [text, setText] = useState("");
  const listId = `${id}-options`;
  const commit = (raw: string) => {
    const names = parseNameList(raw).filter((name) => !value.includes(name));
    if (names.length) onChange([...value, ...names]);
    setText("");
  };

  return (
    <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1 py-0.5 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:opacity-50 dark:bg-input/30">
      {value.map((name) => (
        <span
          key={name}
          className="inline-flex h-6 items-center gap-1 rounded-md border bg-muted/60 pr-0.5 pl-1.5 font-mono text-xs"
        >
          {Icon && <Icon className="size-3 text-muted-foreground" />}
          {name}
          <button
            type="button"
            disabled={disabled}
            aria-label={`${name} entfernen`}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange(value.filter((entry) => entry !== name))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-label={label}
        list={listId}
        value={text}
        disabled={disabled}
        placeholder={value.length ? "" : placeholder}
        className="h-6 min-w-16 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
        onChange={(event) => {
          const next = event.target.value;
          if (/[,\n]/.test(next)) commit(next);
          else setText(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && text.trim()) {
            event.preventDefault();
            commit(text);
          } else if (event.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (text.trim()) commit(text);
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (!/[,\n]/.test(pasted)) return;
          event.preventDefault();
          commit(`${text}${pasted}`);
        }}
      />
      <datalist id={listId}>
        {suggestions
          .filter((entry) => !value.includes(entry))
          .map((entry) => (
            <option key={entry} value={entry} />
          ))}
      </datalist>
    </div>
  );
}

import { XIcon } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, useState } from "react";
import { cn } from "@/lib/utils";

interface Props extends Omit<ComponentProps<"input">, "value" | "onChange"> {
  value: string[];
  onChange: (value: string[]) => void;
  validate?: (value: string) => string | null;
  normalize?: (value: string) => string;
  mono?: boolean;
  separators?: RegExp;
  itemLabel?: string;
}

export function ChipsInput({
  value,
  onChange,
  validate,
  normalize = (entry) => entry.trim(),
  mono,
  separators = /[,;\n]/,
  itemLabel = "Eintrag",
  placeholder,
  className,
  ...input
}: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string) => {
    const entries = raw
      .split(separators)
      .map(normalize)
      .filter(Boolean)
      .filter((entry) => !value.includes(entry));
    if (!entries.length) {
      setDraft("");
      return true;
    }
    const problem = validate ? entries.map(validate).find(Boolean) : null;
    if (problem) {
      setError(problem);
      return false;
    }
    onChange([...value, ...new Set(entries)]);
    setDraft("");
    setError(null);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const separatorKey =
      event.key.length === 1 &&
      new RegExp(separators.source, separators.flags.replace("g", "")).test(event.key);
    if ((event.key === "Enter" || separatorKey) && draft.trim()) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          error && "border-destructive",
          className,
        )}
      >
        {value.map((entry) => (
          <span
            key={entry}
            className={cn(
              "inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs",
              mono && "font-mono",
            )}
          >
            <span className="truncate">{entry}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((item) => item !== entry))}
              aria-label={`${itemLabel} „${entry}“ entfernen`}
              className="grid size-5 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          {...input}
          value={draft}
          placeholder={value.length ? undefined : placeholder}
          onChange={(event) => {
            setError(null);
            if (separators.test(event.target.value)) commit(event.target.value);
            else setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (draft.trim()) commit(draft);
            input.onBlur?.(event);
          }}
          className={cn(
            "h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground",
            mono && "font-mono text-[13px]",
          )}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

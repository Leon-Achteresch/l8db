import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface McpStudioChipsProps {
  label: string;
  values: string[];
  placeholder: string;
  empty: string;
  accent?: boolean;
  onChange: (values: string[]) => void;
}

export function McpStudioChips({
  label,
  values,
  placeholder,
  empty,
  accent,
  onChange,
}: McpStudioChipsProps) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const next = draft
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry && !values.includes(entry));
    if (next.length) onChange([...values, ...next]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/40 p-1.5">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(values.filter((entry) => entry !== value))}
            aria-label={`${value} entfernen`}
            className={cn(
              "group flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs",
              accent ? "bg-primary/15 text-primary" : "bg-background",
            )}
          >
            {value}
            <X className="size-3 opacity-40 group-hover:opacity-100" aria-hidden />
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={values.length ? placeholder : empty}
          aria-label={label}
          className="h-6 min-w-24 flex-1 bg-transparent px-1.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

import { RegexIcon, SearchIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { SidebarInput } from "@/components/ui/sidebar";
import { describeRegexError, type RegexCompileError } from "@/lib/regex-search";
import { useSidebarSearchHistory } from "@/lib/sidebar-search-history";
import { cn } from "@/lib/utils";

interface SidebarSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  regexEnabled: boolean;
  onRegexEnabledChange: (enabled: boolean) => void;
  regexError?: RegexCompileError | null;
}

export function SidebarSearchInput({
  value,
  onChange,
  placeholder,
  regexEnabled,
  onRegexEnabledChange,
  regexError,
}: SidebarSearchInputProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = useSidebarSearchHistory((state) => state.entries);
  const addEntry = useSidebarSearchHistory((state) => state.add);
  const removeEntry = useSidebarSearchHistory((state) => state.remove);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q === "") return entries.slice(0, 8);
    return entries.filter((e) => e.toLowerCase().includes(q) && e !== value).slice(0, 8);
  }, [entries, value]);

  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <SidebarInput
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            addEntry(value);
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        title={regexError ? describeRegexError(regexError) : undefined}
        className={cn("pl-8 pr-8", regexEnabled && "font-mono", regexError && "border-destructive")}
      />
      <button
        type="button"
        aria-pressed={regexEnabled}
        title="Regulären Ausdruck verwenden"
        onClick={() => onRegexEnabledChange(!regexEnabled)}
        className={cn(
          "absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded hover:bg-accent",
          regexEnabled && "bg-primary/15 text-primary",
        )}
      >
        <RegexIcon className="size-3.5" />
      </button>
      {open && suggestions.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover py-1 shadow-md">
          {suggestions.map((entry) => (
            <li key={entry} className="flex items-center">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(entry);
                  addEntry(entry);
                  setOpen(false);
                }}
                className="min-w-0 flex-1 truncate px-2 py-1 text-left text-sm cursor-pointer hover:bg-accent"
              >
                {entry}
              </button>
              <button
                type="button"
                title="Aus Verlauf entfernen"
                onMouseDown={(e) => {
                  e.preventDefault();
                  removeEntry(entry);
                }}
                className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground cursor-pointer hover:bg-accent"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {regexError ? (
        <p className="absolute left-0 right-0 top-full mt-0.5 truncate text-[11px] text-destructive">
          {describeRegexError(regexError)}
        </p>
      ) : null}
    </div>
  );
}

import { RegexIcon, SearchIcon, XIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

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
  const [active, setActive] = useState(-1);
  const listId = useId();
  const entries = useSidebarSearchHistory((state) => state.entries);
  const addEntry = useSidebarSearchHistory((state) => state.add);
  const removeEntry = useSidebarSearchHistory((state) => state.remove);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q === "") return entries.slice(0, 8);
    return entries.filter((e) => e.toLowerCase().includes(q) && e !== value).slice(0, 8);
  }, [entries, value]);
  const shown = open && !regexError ? suggestions : [];
  const pick = (entry: string) => {
    onChange(entry);
    addEntry(entry);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <SidebarInput
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => setOpen(false)}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((previous) => Math.max(-1, Math.min(shown.length - 1, previous + step)));
          } else if (e.key === "Enter") {
            if (shown[active]) pick(shown[active]);
            else {
              addEntry(value);
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            if (shown.length > 0) setOpen(false);
            else if (value) onChange("");
          }
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
          "absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl hover:bg-accent",
          regexEnabled && "bg-primary/15 text-primary",
        )}
      >
        <RegexIcon className="size-3.5" />
      </button>
      {shown.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-popover py-1 shadow-md"
        >
          {shown.map((entry, index) => (
            <div
              key={entry}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cn("flex items-center", index === active && "bg-accent")}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(entry);
                }}
                className="min-w-0 flex-1 truncate px-2 py-1 text-left text-sm cursor-pointer hover:bg-accent"
              >
                {entry}
              </button>
              <button
                type="button"
                title="Aus Verlauf entfernen"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  removeEntry(entry);
                }}
                className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-xl text-muted-foreground cursor-pointer hover:bg-accent"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {regexError ? (
        <p className="absolute left-0 right-0 top-full mt-0.5 truncate text-[11px] text-destructive">
          {describeRegexError(regexError)}
        </p>
      ) : null}
    </div>
  );
}

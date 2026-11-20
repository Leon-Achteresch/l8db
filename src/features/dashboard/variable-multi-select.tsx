import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function VariableMultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const all = [...new Set([...value, ...options])];
  const found = all.filter((option) => option.toLowerCase().includes(search.toLowerCase()));
  const summary =
    value.length === 0 ? "Alle" : value.length <= 2 ? value.join(", ") : `${value.length} gewählt`;
  return (
    <Popover onOpenChange={(open) => !open && setSearch("")}>
      <PopoverTrigger
        aria-label={label}
        title={value.join(", ") || "Alle"}
        className="flex h-7 max-w-48 min-w-24 items-center gap-1 rounded-md px-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-2">
        {all.length > 8 && (
          <Input
            aria-label={`${label} durchsuchen`}
            autoFocus
            placeholder="Suchen…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 text-xs"
          />
        )}
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {found.map((option, index) => (
            <label
              key={option}
              htmlFor={`${id}-${index}`}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted"
            >
              <Checkbox
                id={`${id}-${index}`}
                checked={value.includes(option)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...value, option] : value.filter((item) => item !== option))
                }
              />
              <span className="truncate">{option}</span>
            </label>
          ))}
          {found.length === 0 && (
            <p className="px-1.5 py-3 text-center text-xs text-muted-foreground">Keine Werte</p>
          )}
        </div>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="w-full rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Alle anzeigen
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

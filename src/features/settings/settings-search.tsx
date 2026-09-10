import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";

interface SettingsSearchProps {
  value: string;
  onChange: (val: string) => void;
}

export function SettingsSearch({ value, onChange }: SettingsSearchProps) {
  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Einstellungen durchsuchen …"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-xl pl-9 pr-12 text-xs shadow-xs"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          <Kbd className="text-[10px]">⌘F</Kbd>
        </div>
      )}
    </div>
  );
}

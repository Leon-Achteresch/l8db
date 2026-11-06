import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getDataTypeGroups,
  isListedDataType,
} from "@/features/alter-table/alter-table-view/data-types";
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";

export interface DataTypeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  kind: DatabaseKind;
  className?: string;
}

export function DataTypeCombobox({ value, onChange, kind, className }: DataTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groups = useMemo(() => getDataTypeGroups(kind), [kind]);

  const isCustom = value !== "" && !isListedDataType(groups, value);
  const custom = search.trim();
  const offerCustom = custom !== "" && !isListedDataType(groups, custom);
  const select = (next: string) => {
    onChange(next);
    setSearch("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-left text-xs ring-offset-background hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <span className="truncate font-mono">{value || "Typ wählen…"}</span>
          <ChevronsUpDownIcon className="ml-1 size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder="Typ suchen oder eingeben…"
            className="h-8 text-xs"
          />
          <CommandList className="max-h-60">
            <CommandEmpty>Kein Typ gefunden.</CommandEmpty>
            {offerCustom && (
              <CommandGroup heading="Eigener Typ">
                <CommandItem value={custom} onSelect={() => select(custom)} className="text-xs">
                  <span className="font-mono">„{custom}“ verwenden</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.types.map((t) => (
                  <CommandItem key={t} value={t} onSelect={() => select(t)} className="text-xs">
                    <span className="font-mono">{t}</span>
                    {value.toLowerCase() === t.toLowerCase() && (
                      <CheckIcon className="ml-auto size-3.5" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        {isCustom && (
          <div className="border-t px-2 py-1.5 text-[10px] text-muted-foreground">
            Aktuell: <span className="font-mono">{value}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

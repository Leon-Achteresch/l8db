import { ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GrantableObject } from "@/lib/db";
import { useGrantableObjectsQuery } from "@/lib/queries";

interface ObjectPickerProps {
  owner: string;
  value: GrantableObject | null;
  onChange: (value: GrantableObject) => void;
}

export function ObjectPicker({ owner, value, onChange }: ObjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const { data, isFetching } = useGrantableObjectsQuery(open ? owner : "", search);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 200);
    return () => clearTimeout(timer);
  }, [input]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={!owner}
          className="min-w-0 flex-1 justify-between font-mono text-xs font-normal"
        >
          <span className="truncate">{value?.name ?? "Objekt"}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={input} onValueChange={setInput} placeholder="Objekt suchen …" />
          <CommandList className="max-h-72">
            <CommandEmpty>{isFetching ? "Suche …" : "Keine Treffer."}</CommandEmpty>
            {(data ?? []).map((item) => (
              <CommandItem
                key={`${item.object_type}:${item.name}`}
                value={`${item.object_type}:${item.name}`}
                onSelect={() => {
                  onChange(item);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.name}</span>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                  {item.object_type}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

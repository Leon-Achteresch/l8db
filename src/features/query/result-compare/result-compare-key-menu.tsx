import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ResultCompareKeyMenu({
  columns,
  detected,
  chosen,
  onChange,
}: {
  columns: string[];
  detected: string[];
  chosen: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const effective = chosen ?? detected;
  const label = effective.length > 0 ? effective.join(", ") : "ganze Zeile";
  const toggle = (column: string) => {
    const next = effective.includes(column)
      ? effective.filter((name) => name !== column)
      : columns.filter((name) => name === column || effective.includes(name));
    onChange(next);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 max-w-56 gap-1.5 px-2 text-xs"
          title="Wie Zeilen beider Läufe einander zugeordnet werden"
        >
          <KeyRoundIcon className="size-3 shrink-0" />
          <span className="hidden @min-[44rem]/compare:inline">Schlüssel:</span>
          <span className="truncate font-mono text-[11px]">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          Zeilen zuordnen über
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={chosen === null}
          onCheckedChange={() => onChange(null)}
          onSelect={(event) => event.preventDefault()}
        >
          Automatisch
          <span className="ml-auto truncate pl-2 font-mono text-[11px] text-muted-foreground">
            {detected.length > 0 ? detected.join(", ") : "ganze Zeile"}
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={chosen !== null && chosen.length === 0}
          onCheckedChange={() => onChange([])}
          onSelect={(event) => event.preventDefault()}
        >
          Ganze Zeile, ohne Schlüssel
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          Schlüsselspalten
        </DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={effective.includes(column)}
            onCheckedChange={() => toggle(column)}
            onSelect={(event) => event.preventDefault()}
            className="font-mono text-[11px]"
          >
            {column}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

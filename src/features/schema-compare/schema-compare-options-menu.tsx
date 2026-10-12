import { ChevronDownIcon, LayersIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activeTypes, connectionFor, useSchemaCompareStore } from "@/lib/schema-compare/store";
import {
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
  OBJECT_TYPE_META,
  type SchemaCompareOptions,
} from "@/lib/schema-compare/types";
import { SchemaObjectIcon } from "./schema-object-icon";

const OPTION_LABELS: { key: keyof SchemaCompareOptions; label: string; hint: string }[] = [
  {
    key: "ignoreWhitespace",
    label: "Leerzeichen und Umbrüche",
    hint: "Formatierungsunterschiede im Quelltext gelten nicht als Änderung.",
  },
  {
    key: "ignoreSystemNames",
    label: "Systemgenerierte Namen",
    hint: "Constraints und Indizes wie SYS_C… werden über ihre Definition zugeordnet.",
  },
  {
    key: "ignoreSequenceValues",
    label: "Aktuelle Sequenzwerte",
    hint: "Nur Inkrement, Grenzen, Cache und Zyklus werden verglichen.",
  },
  {
    key: "ignoreCase",
    label: "Groß- und Kleinschreibung",
    hint: "Vergleicht Quelltext ohne Beachtung der Schreibweise.",
  },
];

const keep = (event: Event) => event.preventDefault();

export function SchemaCompareOptionsMenu() {
  const state = useSchemaCompareStore();
  const set = useSchemaCompareStore.setState;
  const kind = connectionFor(state.source)?.kind ?? connectionFor(state.target)?.kind;
  const supported = compareTypesFor(kind);
  const selected = activeTypes(state, kind);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
          <SlidersHorizontalIcon className="size-3.5" />
          Optionen
          {supported.length > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {selected.length} von {supported.length}
            </span>
          )}
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Vergleichen</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={supported.length === 0}>
            <LayersIcon className="size-3.5" />
            Objekttypen wählen
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {selected.length} von {supported.length}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {supported.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={selected.includes(type)}
                onSelect={keep}
                onCheckedChange={(checked) =>
                  set({
                    types: checked
                      ? supported.filter((item) => item === type || selected.includes(item))
                      : selected.filter((item) => item !== type),
                  })
                }
              >
                <SchemaObjectIcon type={type} />
                {OBJECT_TYPE_META[type].plural}
                {type === "table" && <span className="text-muted-foreground">inkl. Spalten</span>}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={keep} onClick={() => set({ types: supported })}>
              Alle
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={keep} onClick={() => set({ types: [] })}>
              Keine
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Ignorieren</DropdownMenuLabel>
        {OPTION_LABELS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.key}
            title={option.hint}
            checked={state.options[option.key]}
            onSelect={keep}
            onCheckedChange={(checked) =>
              set({ options: { ...state.options, [option.key]: checked === true } })
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={keep}
          onClick={() => set({ options: DEFAULT_COMPARE_OPTIONS, types: null })}
        >
          Zurücksetzen
          <span className="ml-auto text-xs text-muted-foreground">Standard</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

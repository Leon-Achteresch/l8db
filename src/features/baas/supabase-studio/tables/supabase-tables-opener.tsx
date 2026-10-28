import { History, Table2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BaasSidebarItem } from "../../baas-sidebar-item";
import { parseTableName, type StudioTableRef } from "./supabase-tables-utils";

export function SupabaseTablesOpener({
  selected,
  recent,
  onSelect,
}: {
  selected: StudioTableRef | null;
  recent: StudioTableRef[];
  onSelect: (table: StudioTableRef) => void;
}) {
  const [input, setInput] = useState("");
  const parsed = parseTableName(input);

  return (
    <div className="grid min-w-0 content-start gap-2">
      <p className="px-1 text-xs text-muted-foreground">
        Mit diesem Key gibt Supabase keine Tabellenliste heraus. Öffne Tabellen über ihren Namen.
      </p>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed) onSelect(parsed);
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="tabelle oder schema.tabelle"
          aria-label="Tabellenname"
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-0 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={!parsed}>
          Öffnen
        </Button>
      </form>
      {recent.length > 0 && (
        <div className="grid gap-1">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <History className="size-3" /> Zuletzt geöffnet
          </p>
          <div className="grid gap-0.5">
            {recent.map((entry) => (
              <BaasSidebarItem
                key={`${entry.schema}.${entry.name}`}
                icon={Table2}
                active={selected?.schema === entry.schema && selected.name === entry.name}
                onClick={() => onSelect(entry)}
              >
                {entry.schema === "public" ? entry.name : `${entry.schema}.${entry.name}`}
              </BaasSidebarItem>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { History } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <p className="text-xs text-muted-foreground">
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
          <div className="overflow-hidden rounded-lg border">
            {recent.map((entry) => {
              const active = selected?.schema === entry.schema && selected.name === entry.name;
              return (
                <button
                  key={`${entry.schema}.${entry.name}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(entry)}
                  className={`block w-full truncate border-b px-3 py-1.5 text-left font-mono text-xs last:border-b-0 ${active ? "bg-primary/10" : "hover:bg-muted"}`}
                >
                  {entry.schema === "public" ? entry.name : `${entry.schema}.${entry.name}`}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

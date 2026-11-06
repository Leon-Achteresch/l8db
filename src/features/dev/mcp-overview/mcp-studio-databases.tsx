import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { LabDatabase } from "./data";

interface McpStudioDatabasesProps {
  databases: LabDatabase[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onExpose: (ids: string[], exposed: boolean) => void;
}

export function McpStudioDatabases({
  databases,
  selected,
  onSelect,
  onExpose,
}: McpStudioDatabasesProps) {
  const [filter, setFilter] = useState("");
  const [onlyExposed, setOnlyExposed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(databases.length > 20 ? [] : databases.map((entry) => entry.group)),
  );
  const exposedCount = databases.filter((entry) => entry.exposed).length;
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, LabDatabase[]>();
    for (const entry of databases) {
      if (onlyExposed && !entry.exposed) continue;
      if (needle && !`${entry.name} ${entry.group} ${entry.kind}`.toLowerCase().includes(needle))
        continue;
      map.set(entry.group, [...(map.get(entry.group) ?? []), entry]);
    }
    return [...map];
  }, [databases, filter, onlyExposed]);

  const toggleGroup = (group: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Datenbanken filtern"
          aria-label="Datenbanken filtern"
          className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => setOnlyExposed(!onlyExposed)}
          aria-pressed={onlyExposed}
          className={cn(
            "cursor-pointer rounded-md px-2 py-0.5 font-mono text-xs tabular-nums hover:bg-muted",
            onlyExposed ? "bg-primary/15 text-primary" : "text-muted-foreground",
          )}
        >
          {exposedCount}/{databases.length}
        </button>
      </div>
      <div className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
        {groups.map(([group, items]) => {
          const on = items.filter((item) => item.exposed).length;
          const open = filter !== "" || onlyExposed || expanded.has(group);
          return (
            <div key={group}>
              <div className="flex items-center gap-2 px-1 py-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  aria-expanded={open}
                  className="flex flex-1 cursor-pointer items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={cn("size-3.5 transition-transform", open && "rotate-90")}
                    aria-hidden
                  />
                  {group}
                  <span className="font-mono font-normal tabular-nums">
                    {on}/{items.length}
                  </span>
                </button>
                <Switch
                  checked={on === items.length}
                  onCheckedChange={(value) =>
                    onExpose(
                      items.map((item) => item.id),
                      value,
                    )
                  }
                  aria-label={`Gruppe ${group} freigeben`}
                  className={cn(on > 0 && on < items.length && "opacity-60")}
                />
              </div>
              {open &&
                items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-1 rounded-lg pr-1 transition-colors",
                      selected === item.id ? "bg-primary/10" : "hover:bg-muted/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(selected === item.id ? null : item.id)}
                      className={cn(
                        "flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm",
                        !item.exposed && "text-muted-foreground",
                      )}
                    >
                      <ProviderLogo
                        kind={item.kind}
                        className={cn("size-4", !item.exposed && "opacity-50 grayscale")}
                      />
                      <span className="truncate">{item.name}</span>
                      {item.environment === "production" && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-amber-500"
                          title="Produktion"
                        />
                      )}
                    </button>
                    <Switch
                      checked={item.exposed}
                      onCheckedChange={(value) => onExpose([item.id], value)}
                      aria-label={`${item.name} freigeben`}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Keine Treffer</p>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PlsqlMember } from "@/lib/plsql";
import { cn } from "@/lib/utils";

export function PackageMemberOutline({
  members,
  activeName,
  onSelect,
}: {
  members: PlsqlMember[];
  activeName?: string;
  onSelect: (member: PlsqlMember) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (!needle) return members;
    return members.filter((m) => m.name.includes(needle));
  }, [members, query]);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/20">
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Mitglieder
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{members.length}</span>
      </div>
      {members.length > 8 ? (
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtern…"
            className="h-7 rounded-md px-2 text-xs"
          />
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-1.5">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Keine Treffer.</p>
          ) : (
            filtered.map((member) => {
              const active = member.name === activeName;
              return (
                <button
                  key={`${member.kind}:${member.name}`}
                  type="button"
                  onClick={() => onSelect(member)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/80 hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {member.kind === "FUNCTION" ? "fn" : "pr"}
                  </span>
                  <span className="truncate font-mono text-xs">{member.name}</span>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

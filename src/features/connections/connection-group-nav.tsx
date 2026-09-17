import { Database, Star } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import type { ServerGroup } from "@/lib/connection-groups";
import { providerFor } from "@/lib/connection-url";
import { cn } from "@/lib/utils";

interface Props {
  groups: ServerGroup[];
  selectedKey: string;
  allCount: number;
  favoriteKeys: string[];
  activeGroupKey: string | null;
  onSelect: (key: string) => void;
}

export function ConnectionGroupNav({
  groups,
  selectedKey,
  allCount,
  favoriteKeys,
  activeGroupKey,
  onSelect,
}: Props) {
  return (
    <nav aria-label="Servergruppen" className="flex min-h-0 flex-col gap-3">
      <div>
        <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Übersicht
        </p>
        <button
          type="button"
          onClick={() => onSelect("all")}
          className={cn(
            "group flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selectedKey === "all"
              ? "bg-accent font-semibold text-accent-foreground shadow-2xs"
              : "text-foreground/80 hover:bg-muted/70",
          )}
        >
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-md border",
                selectedKey === "all"
                  ? "border-accent-foreground/20 bg-background"
                  : "border-border/60 bg-muted/50 text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Database className="size-3.5" />
            </span>
            <span className="font-medium">Alle Verbindungen</span>
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-mono tabular-nums",
              selectedKey === "all"
                ? "bg-background text-foreground font-semibold"
                : "bg-muted text-muted-foreground",
            )}
          >
            {allCount}
          </span>
        </button>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between px-2 pb-1.5">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Hosts &amp; Server
          </p>
          <span className="text-[10px] text-muted-foreground">{groups.length}</span>
        </div>
        <ul className="flex flex-col gap-1 overflow-y-auto pr-0.5">
          {groups.map((group) => {
            const selected = selectedKey === group.key;
            const favorite = favoriteKeys.includes(group.key);
            const active = activeGroupKey === group.key;
            const provider = providerFor(group.connections[0]);
            return (
              <li key={group.key}>
                <button
                  type="button"
                  onClick={() => onSelect(group.key)}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "bg-accent font-semibold text-accent-foreground shadow-2xs"
                      : "text-foreground/80 hover:bg-muted/70",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-md border bg-background",
                      selected ? "border-accent-foreground/20" : "border-border/60",
                    )}
                  >
                    <ProviderLogo providerId={provider.id} kind={group.kind} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {active && (
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"
                          title="Aktive Verbindung in diesem Host"
                        />
                      )}
                      <span className="truncate font-mono text-xs">{group.label}</span>
                      {favorite && (
                        <Star className="size-2.5 shrink-0 fill-current text-amber-500" />
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {provider.name}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-mono tabular-nums shrink-0",
                      selected
                        ? "bg-background text-foreground font-semibold"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {group.connections.length}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

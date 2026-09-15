import { Star } from "lucide-react";
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
    <nav aria-label="Servergruppen" className="flex min-h-0 flex-col">
      <button
        type="button"
        onClick={() => onSelect("all")}
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
          selectedKey === "all" ? "bg-muted font-medium" : "text-foreground/80",
        )}
      >
        <span>Alle</span>
        <span className="tabular-nums text-[11px] text-muted-foreground">{allCount}</span>
      </button>
      <ul className="mt-1 flex flex-col gap-0.5">
        {groups.map((group) => {
          const selected = selectedKey === group.key;
          const favorite = favoriteKeys.includes(group.key);
          const active = activeGroupKey === group.key;
          return (
            <li key={group.key}>
              <button
                type="button"
                onClick={() => onSelect(group.key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "bg-muted",
                  active && !selected && "ring-1 ring-foreground/15",
                )}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-background">
                  <ProviderLogo
                    providerId={providerFor(group.connections[0]).id}
                    kind={group.kind}
                    className="size-3.5"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    {favorite && <Star className="size-3 shrink-0 fill-current text-amber-500" />}
                    <span className="truncate font-mono text-[12px]">{group.label}</span>
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {providerFor(group.connections[0]).name}
                  </span>
                </span>
                <span className="tabular-nums text-[11px] text-muted-foreground">
                  {group.connections.length}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

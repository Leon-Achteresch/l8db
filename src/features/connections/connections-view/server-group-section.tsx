import {
  ArrowDown,
  ArrowUp,
  Group,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type HostGroupRule, type ServerGroup, suggestHostPattern } from "@/lib/connection-groups";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { capabilitiesFor } from "@/lib/providers";

export function ConnectionServerGroupSection({
  group,
  favoriteServerKeys,
  allGroups,
  openEditor,
  setBulkGroup,
  setSchemasToUser,
  toggleServerFavorite,
  setRulesDialog,
  moveServerGroup,
  setDeleteGroup,
  renderCard,
}: {
  group: ServerGroup;
  favoriteServerKeys: string[];
  allGroups: ServerGroup[];
  openEditor: (id: string | null, from?: SavedConnection | null) => void;
  setBulkGroup: (group: ServerGroup) => void;
  setSchemasToUser: (group: ServerGroup) => void;
  toggleServerFavorite: (value: string) => void;
  setRulesDialog: (value: { draft: Omit<HostGroupRule, "id"> | null }) => void;
  moveServerGroup: (key: string, delta: number) => void;
  setDeleteGroup: (group: ServerGroup) => void;
  renderCard: (connection: SavedConnection) => ReactNode;
}) {
  const provider = providerFor(group.connections[0]);
  return (
    <section className="flex flex-col gap-3">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/95 px-3 py-2 shadow-2xs backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/40">
            <ProviderLogo providerId={provider.id} kind={group.kind} className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-mono text-sm font-semibold tracking-tight">
                {group.label}
              </h2>
              {favoriteServerKeys.includes(group.key) && (
                <Star className="size-3 shrink-0 fill-current text-amber-500" />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {group.connections.length}{" "}
              {group.connections.length === 1 ? "Verbindung" : "Verbindungen"}
              {` · ${provider.name}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={() => openEditor("new", group.connections[0])}
          >
            <Plus className="size-3.5" />
            Verbindung hinzufügen
          </Button>
          {group.connections.length > 1 && !group.ruleId && group.kind === "oracle" && (
            <Button variant="outline" size="xs" onClick={() => setBulkGroup(group)}>
              <Pencil className="size-3.5" />
              Host &amp; Service
            </Button>
          )}
          {group.connections.length > 1 && capabilitiesFor(group.kind).schemas && (
            <Button variant="outline" size="xs" onClick={() => setSchemasToUser(group)}>
              <KeyRound className="size-3.5" />
              Schema = User
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`${group.label} Aktionen`}>
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => toggleServerFavorite(group.key)}>
                <Star
                  className={
                    favoriteServerKeys.includes(group.key)
                      ? "size-3.5 fill-current text-amber-500"
                      : "size-3.5"
                  }
                />
                {favoriteServerKeys.includes(group.key) ? "Aus Favoriten" : "Als Favorit"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  const first = group.connections[0];
                  setRulesDialog({
                    draft:
                      group.ruleId || !first
                        ? null
                        : { name: "", pattern: suggestHostPattern(first) },
                  });
                }}
              >
                <Group className="size-3.5" />
                {group.ruleId ? "Gruppierung bearbeiten" : "Ähnliche Hosts gruppieren"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={allGroups[0]?.key === group.key}
                onSelect={() => moveServerGroup(group.key, -1)}
              >
                <ArrowUp className="size-3.5" />
                Nach oben
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={allGroups.at(-1)?.key === group.key}
                onSelect={() => moveServerGroup(group.key, 1)}
              >
                <ArrowDown className="size-3.5" />
                Nach unten
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteGroup(group)}>
                <Trash2 className="size-3.5" />
                Alle löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {group.connections.map(renderCard)}
      </div>
    </section>
  );
}

import { Check, ChevronDown, ListFilter, Pencil, Star, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { ProviderLogo } from "@/components/provider-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { cn } from "@/lib/utils";
import { SavedConnectionChip } from "./saved-connection-chip";

interface Props {
  connections: SavedConnection[];
  activeId: string | null;
  connectingId: string | null;
  onOpen: (connection: SavedConnection) => void;
  onEdit: (connection: SavedConnection) => void;
  onDelete: (connection: SavedConnection) => void;
  onToggleFavorite: (connection: SavedConnection) => void;
}

export function ConnectionSwitcher({
  connections,
  activeId,
  connectingId,
  onOpen,
  onEdit,
  onDelete,
  onToggleFavorite,
}: Props) {
  const quickConnections = useMemo(() => {
    const active = connections.find((connection) => connection.id === activeId);
    const favorites = connections.filter(
      (connection) => connection.favorite && connection.id !== activeId,
    );
    const rest = connections.filter(
      (connection) => connection.id !== activeId && !connection.favorite,
    );
    const prioritized = active ? [active, ...favorites, ...rest] : [...favorites, ...rest];
    return prioritized.slice(0, connections.length > 6 ? 4 : 5);
  }, [activeId, connections]);

  return (
    <section
      aria-label="Verbindungen wechseln"
      className="mb-3 flex min-w-0 shrink-0 items-center gap-2 rounded-2xl border border-border/70 bg-card/55 p-1.5 shadow-sm"
    >
      <div className="hidden shrink-0 items-center gap-2 px-1.5 sm:flex">
        <span className="grid size-7 place-items-center rounded-lg bg-muted/70 text-muted-foreground">
          <ListFilter className="size-3.5" />
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">Verbindungen</span>
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto py-px">
          {quickConnections.map((connection) => (
            <SavedConnectionChip
              key={connection.id}
              connection={connection}
              active={activeId === connection.id}
              connecting={connectingId === connection.id}
              onOpen={() => onOpen(connection)}
              onEdit={() => onEdit(connection)}
              onDelete={() => onDelete(connection)}
              onToggleFavorite={() => onToggleFavorite(connection)}
            />
          ))}
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card/80 to-transparent"
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Alle Verbindungen anzeigen (${connections.length})`}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border/70 bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span className="tabular-nums">{connections.length}</span>
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="flex items-center justify-between px-2.5">
            <span>Alle Verbindungen</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {connections.length}
            </span>
          </DropdownMenuLabel>
          {connections.map((connection) => {
            const provider = providerFor(connection);
            const active = activeId === connection.id;
            return (
              <DropdownMenuItem
                key={connection.id}
                onSelect={() => onOpen(connection)}
                className="gap-2.5 px-2.5 py-2"
              >
                <ConnectionStatusIndicator connectionId={connection.id} />
                <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-muted/50">
                  <ProviderLogo
                    providerId={provider.id}
                    kind={connection.kind}
                    className="size-3.5"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{connection.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {provider.name}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={
                    connection.favorite
                      ? `${connection.name} aus Favoriten entfernen`
                      : `${connection.name} als Favorit markieren`
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(connection);
                  }}
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-muted",
                    connection.favorite
                      ? "text-amber-500"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Star className={cn("size-3.5", connection.favorite && "fill-current")} />
                </button>
                <button
                  type="button"
                  aria-label={`${connection.name} bearbeiten`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(connection);
                  }}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`${connection.name} entfernen`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(connection);
                  }}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
                {active && <Check className="size-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
        </DropdownMenuContent>
      </DropdownMenu>
    </section>
  );
}

import { Copy, CopyPlus, KeyRound, Pencil, Play, Star, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { ProviderLogo } from "@/components/provider-logo";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import { connectionColorLabel, type SavedConnection } from "@/lib/connections";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props {
  connection: SavedConnection;
  active: boolean;
  connecting: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCreateSimilar: () => void;
  onToggleFavorite: () => void;
}

export function ConnectionPickCard({
  connection,
  active,
  connecting,
  onOpen,
  onEdit,
  onDelete,
  onDuplicate,
  onCreateSimilar,
  onToggleFavorite,
}: Props) {
  const reduce = useReducedMotion();
  const colorLabel = connectionColorLabel(connection.color);
  const favorite = Boolean(connection.favorite);
  const provider = providerFor(connection);
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  const host = endpoint.port ? `${endpoint.host}:${endpoint.port}` : endpoint.host;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <motion.article
          layout
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={reduce ? undefined : { y: -1 }}
          whileTap={reduce ? undefined : { scale: 0.99 }}
          transition={{ ...SPRING_PRESS, layout: SPRING_LAYOUT }}
          className={cn(
            "relative flex min-h-[13.5rem] flex-col justify-between overflow-hidden rounded-2xl border bg-card px-4 py-4",
            active ? "border-foreground/25" : "border-border",
          )}
        >
          {connection.color && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: connection.color }}
            />
          )}
          <div className="flex items-start justify-between gap-3">
            <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
              <span className="grid size-10 place-items-center rounded-lg border border-border bg-muted/50">
                <ProviderLogo providerId={provider.id} kind={connection.kind} className="size-5" />
              </span>
              <span className="mt-3 flex min-w-0 items-center gap-2">
                <ConnectionStatusIndicator connectionId={connection.id} />
                <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">
                  {connection.name}
                </h2>
              </span>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {provider.name}
                {colorLabel ? ` · ${colorLabel}` : ""}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label={
                  favorite
                    ? `${connection.name} aus Favoriten entfernen`
                    : `${connection.name} als Favorit markieren`
                }
                aria-pressed={favorite}
                onClick={onToggleFavorite}
                className={cn(
                  "grid size-8 place-items-center rounded-md hover:bg-muted",
                  favorite ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Star className={cn("size-3.5", favorite && "fill-current")} />
              </button>
              <button
                type="button"
                aria-label={`${connection.name} bearbeiten`}
                onClick={onEdit}
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`${connection.name} entfernen`}
                onClick={onDelete}
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="mt-6 flex w-full items-end justify-between gap-3 text-left"
          >
            <span className="min-w-0">
              {endpoint.user ? (
                <span className="mb-1 flex items-center gap-1 truncate font-mono text-xs text-foreground/80">
                  <KeyRound className="size-3 shrink-0 text-muted-foreground" />
                  {endpoint.user}
                </span>
              ) : null}
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {host}
              </span>
              {endpoint.database ? (
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                  {endpoint.database}
                </span>
              ) : null}
            </span>
            <AnimatedBadge
              status={connecting ? "loading" : active ? "success" : "neutral"}
              size="sm"
            >
              {connecting ? "…" : active ? "Aktiv" : "Öffnen"}
            </AnimatedBadge>
          </button>
        </motion.article>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen}>
          <Play className="size-3.5" />
          {active ? "Trennen" : "Öffnen"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onEdit}>
          <Pencil className="size-3.5" />
          Bearbeiten
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDuplicate}>
          <Copy className="size-3.5" />
          Duplizieren
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCreateSimilar}>
          <CopyPlus className="size-3.5" />
          Ähnliche erstellen
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className="size-3.5" />
          Löschen
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

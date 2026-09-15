import {
  AppWindow,
  Copy,
  CopyPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import { connectionColorLabel, type SavedConnection } from "@/lib/connections";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export const CONNECTION_ROW_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(6rem,0.5fr)_minmax(7rem,0.7fr)_minmax(8rem,0.85fr)_6.75rem] items-center gap-2";

interface Props {
  connection: SavedConnection;
  active: boolean;
  onOpen: () => void;
  onOpenWindow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCreateSimilar: () => void;
  onToggleFavorite: () => void;
}

export function ConnectionPickCard({
  connection,
  active,
  onOpen,
  onOpenWindow,
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
  const target = endpoint.database || endpoint.host;
  const schema = connection.schemas?.length ? connection.schemas.join(", ") : "—";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <motion.article
          layout
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ layout: SPRING_LAYOUT }}
          className={cn(
            "group relative rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted/40",
            active && "border-foreground/20 bg-muted/50",
          )}
        >
          {connection.color && (
            <span
              aria-hidden
              className="absolute inset-y-1.5 left-0 w-0.5 rounded-full"
              style={{ backgroundColor: connection.color }}
            />
          )}
          <div className={CONNECTION_ROW_GRID}>
            <button
              type="button"
              onClick={onOpen}
              className="flex min-w-0 items-center gap-2.5 text-left"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-background">
                <ProviderLogo
                  providerId={provider.id}
                  kind={connection.kind}
                  className="size-3.5"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <ConnectionStatusIndicator connectionId={connection.id} />
                  <h2 className="min-w-0 truncate text-[13px] font-medium tracking-tight">
                    {connection.name}
                  </h2>
                </span>
                <p className="truncate text-[11px] text-muted-foreground">
                  {provider.name}
                  {connection.ssh?.host ? " · SSH" : ""}
                  {colorLabel ? ` · ${colorLabel}` : ""}
                  {connection.readOnly ? " · Nur lesen" : ""}
                </p>
              </span>
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 truncate text-left font-mono text-[12px] text-muted-foreground"
              title={endpoint.user || undefined}
            >
              {endpoint.user || "—"}
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 truncate text-left font-mono text-[12px] text-muted-foreground"
              title={`${target}${schema !== "—" ? ` · ${schema}` : ""}`}
            >
              <span className="block truncate">{target}</span>
              {schema !== "—" && <span className="block truncate text-[10px]">{schema}</span>}
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="flex min-w-0 flex-wrap items-center gap-1 text-left"
              title={connection.tags?.map((tag) => tag.name).join(", ") || undefined}
            >
              {connection.tags?.length ? (
                connection.tags.map((tag) => (
                  <span
                    key={tag.name}
                    className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </span>
                ))
              ) : (
                <span className="text-[12px] text-muted-foreground">—</span>
              )}
            </button>
            <div className="flex items-center justify-end gap-0.5">
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
                  "grid size-7 place-items-center rounded-md hover:bg-muted",
                  favorite ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Star className={cn("size-3.5", favorite && "fill-current")} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${connection.name} Aktionen`}
                    className="text-muted-foreground"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={onOpen}>
                    <Play className="size-3.5" />
                    {active ? "Trennen" : "Öffnen"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil className="size-3.5" />
                    Bearbeiten
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onOpenWindow}>
                    <AppWindow className="size-3.5" />
                    In neuem Fenster
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onDuplicate}>
                    <Copy className="size-3.5" />
                    Duplizieren
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onCreateSimilar}>
                    <CopyPlus className="size-3.5" />
                    Ähnliche erstellen
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash2 className="size-3.5" />
                    Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </motion.article>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen}>
          <Play className="size-3.5" />
          {active ? "Trennen" : "Öffnen"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenWindow}>
          <AppWindow className="size-3.5" />
          In neuem Fenster öffnen
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

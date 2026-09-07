import { Pencil, Star, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { ProviderLogo } from "@/components/provider-logo";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props {
  connection: SavedConnection;
  active: boolean;
  connecting: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

export function SavedConnectionChip({
  connection,
  active,
  connecting,
  onOpen,
  onEdit,
  onDelete,
  onToggleFavorite,
}: Props) {
  const provider = providerFor(connection);
  const favorite = Boolean(connection.favorite);
  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className={cn(
        "flex min-w-[12.5rem] items-center gap-2 rounded-2xl border bg-card/90 px-2.5 py-2 shadow-sm",
        active ? "border-primary ring-2 ring-primary/25" : "border-border/70",
      )}
      style={
        connection.color ? { borderLeftWidth: 4, borderLeftColor: connection.color } : undefined
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="grid size-8 place-items-center rounded-xl bg-background ring-1 ring-border">
          <ProviderLogo providerId={provider.id} kind={connection.kind} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <ConnectionStatusIndicator connectionId={connection.id} />
            <span className="truncate text-xs font-semibold">{connection.name}</span>
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">{provider.name}</span>
        </span>
        <AnimatedBadge status={connecting ? "loading" : active ? "success" : "neutral"} size="sm">
          {connecting ? "…" : active ? "An" : "Öffnen"}
        </AnimatedBadge>
      </button>
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
          "grid size-7 place-items-center rounded-full hover:bg-muted",
          favorite ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Star className={cn("size-3.5", favorite && "fill-current")} />
      </button>
      <button
        type="button"
        aria-label={`${connection.name} bearbeiten`}
        onClick={onEdit}
        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={`${connection.name} entfernen`}
        onClick={onDelete}
        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </motion.div>
  );
}

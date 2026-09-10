import { Pencil, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { ProviderLogo } from "@/components/provider-logo";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props {
  connection: SavedConnection;
  active: boolean;
  connecting: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ConnectionPickCard({
  connection,
  active,
  connecting,
  onOpen,
  onEdit,
  onDelete,
}: Props) {
  const reduce = useReducedMotion();
  const provider = providerFor(connection);
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  const host = endpoint.port ? `${endpoint.host}:${endpoint.port}` : endpoint.host;

  return (
    <motion.article
      layout
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reduce ? undefined : { y: -1 }}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      transition={{ ...SPRING_PRESS, layout: SPRING_LAYOUT }}
      className={cn(
        "flex min-h-[13.5rem] flex-col justify-between rounded-2xl border bg-card px-4 py-4",
        active ? "border-foreground/25" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="grid size-10 place-items-center rounded-lg border border-border bg-muted/50">
            <ProviderLogo providerId={provider.id} kind={connection.kind} className="size-5" />
          </span>
          <h2 className="mt-3 truncate text-lg font-semibold tracking-tight">{connection.name}</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{provider.name}</p>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
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
          <span className="block truncate font-mono text-[11px] text-muted-foreground">{host}</span>
          {endpoint.database ? (
            <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
              {endpoint.database}
            </span>
          ) : null}
        </span>
        <AnimatedBadge status={connecting ? "loading" : active ? "success" : "neutral"} size="sm">
          {connecting ? "…" : active ? "Aktiv" : "Öffnen"}
        </AnimatedBadge>
      </button>
    </motion.article>
  );
}

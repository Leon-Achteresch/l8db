import {
  Archive,
  Copy,
  CopyPlus,
  Database,
  MoreHorizontal,
  Pencil,
  Play,
  ShieldCheck,
  Star,
  Terminal,
  Trash2,
  Unplug,
  User,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface Props {
  connection: SavedConnection;
  active: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCreateSimilar: () => void;
  onToggleFavorite: () => void;
  onBackup?: () => void;
}

export function ConnectionPickCard({
  connection,
  active,
  onOpen,
  onEdit,
  onDelete,
  onDuplicate,
  onCreateSimilar,
  onToggleFavorite,
  onBackup,
}: Props) {
  const favorite = Boolean(connection.favorite);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ConnectionCardShell
          connection={connection}
          active={active}
          onDoubleClick={onOpen}
          actions={
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label={
                  favorite
                    ? `${connection.name} aus Favoriten entfernen`
                    : `${connection.name} als Favorit markieren`
                }
                aria-pressed={favorite}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                className={cn(
                  "grid size-7 place-items-center rounded-md transition-colors hover:bg-muted",
                  favorite ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground",
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
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={onOpen}>
                    <Play className="size-3.5" />
                    {active ? "Trennen" : "Verbinden"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil className="size-3.5" />
                    Bearbeiten
                  </DropdownMenuItem>
                  {onBackup && (
                    <DropdownMenuItem onSelect={onBackup}>
                      <Archive className="size-3.5" />
                      Sichern & Wiederherstellen…
                    </DropdownMenuItem>
                  )}
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
          }
          footer={
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/40 pt-3">
              <Button
                variant="ghost"
                size="xs"
                onClick={onEdit}
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil className="size-3" />
                Bearbeiten
              </Button>
              <div className="flex items-center gap-1">
                {active ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={onOpen}
                    className="border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  >
                    <Unplug className="size-3" />
                    Trennen
                  </Button>
                ) : (
                  <Button variant="default" size="xs" onClick={onOpen} className="gap-1 shadow-2xs">
                    <Play className="size-3" />
                    Verbinden
                  </Button>
                )}
              </div>
            </div>
          }
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen}>
          <Play className="size-3.5" />
          {active ? "Trennen" : "Verbinden"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onEdit}>
          <Pencil className="size-3.5" />
          Bearbeiten
        </ContextMenuItem>
        {onBackup && (
          <ContextMenuItem onSelect={onBackup}>
            <Archive className="size-3.5" />
            Sichern & Wiederherstellen…
          </ContextMenuItem>
        )}
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

export function ConnectionSelectCard({
  connection,
  checked,
  disabledReason,
  onCheckedChange,
  children,
}: {
  connection: SavedConnection;
  checked: boolean;
  disabledReason?: string | null;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  const disabled = Boolean(disabledReason);

  return (
    <ConnectionCardShell
      connection={connection}
      active={checked}
      onClick={(event) => {
        if (disabled || (event.target as HTMLElement).closest("[data-no-toggle]")) return;
        onCheckedChange(!checked);
      }}
      className={disabled ? "opacity-60" : "cursor-pointer"}
      actions={
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`${connection.name} aktivieren`}
          className="m-1.5"
        />
      }
      badges={
        disabledReason ? (
          <span className="inline-flex items-center rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
            {disabledReason}
          </span>
        ) : null
      }
      footer={children}
    />
  );
}

function ConnectionCardShell({
  connection,
  active,
  actions,
  badges,
  footer,
  className,
  ...rest
}: {
  connection: SavedConnection;
  active: boolean;
  actions: ReactNode;
  badges?: ReactNode;
  footer?: ReactNode;
} & ComponentProps<typeof motion.article>) {
  const reduce = useReducedMotion();
  const colorLabel = connectionColorLabel(connection.color);
  const provider = providerFor(connection);
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  const target = endpoint.database || endpoint.host;
  const schema = connection.schemas?.length ? connection.schemas.join(", ") : null;

  return (
    <motion.article
      layout
      initial={reduce ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ layout: SPRING_LAYOUT }}
      {...rest}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-xl border bg-card p-4 transition-all duration-200 hover:border-foreground/25 hover:shadow-md",
        active
          ? "border-primary/50 bg-primary/[0.03] ring-1 ring-primary/30 shadow-xs"
          : "border-border/80",
        className,
      )}
    >
      {connection.color && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-1"
          style={{ backgroundColor: connection.color }}
        />
      )}

      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={cn(
                "relative grid size-10 shrink-0 place-items-center rounded-lg border bg-background/80 shadow-2xs transition-transform group-hover:scale-105",
                active && "border-primary/40",
              )}
            >
              <ProviderLogo providerId={provider.id} kind={connection.kind} className="size-5" />
              <span className="absolute -bottom-1 -right-1">
                <ConnectionStatusIndicator connectionId={connection.id} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-sm font-semibold tracking-tight text-foreground"
                title={connection.name}
              >
                {connection.name}
              </h3>
              <p className="truncate text-[11px] text-muted-foreground">
                {provider.name}
                {colorLabel ? ` · ${colorLabel}` : ""}
              </p>
            </div>
          </div>
          {actions}
        </div>

        <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 p-2.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Database className="size-3 shrink-0 text-muted-foreground/70" />
            <span className="truncate font-mono font-medium text-foreground/90">
              {target || "Standard"}
            </span>
            {schema && <span className="truncate text-muted-foreground/80">/ {schema}</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
            <User className="size-3 shrink-0 text-muted-foreground/70" />
            <span className="truncate font-mono">{endpoint.user || "Kein Benutzer"}</span>
            {endpoint.host && (
              <span className="truncate text-muted-foreground/60">
                @{endpoint.host}
                {endpoint.port ? `:${endpoint.port}` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex min-h-[20px] flex-wrap items-center gap-1.5">
          {badges}
          {connection.ssh?.host && (
            <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
              <Terminal className="size-2.5" />
              SSH
            </span>
          )}
          {connection.sslMode && connection.sslMode !== "disable" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-2.5" />
              TLS
            </span>
          )}
          {connection.readOnly && (
            <span className="inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Nur lesen
            </span>
          )}
          {connection.tags?.map((tag) => (
            <span
              key={tag.name}
              className="inline-flex max-w-[120px] items-center gap-1 truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="truncate">{tag.name}</span>
            </span>
          ))}
        </div>
      </div>

      {footer}
    </motion.article>
  );
}

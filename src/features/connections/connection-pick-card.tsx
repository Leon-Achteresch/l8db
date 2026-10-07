import {
  Archive,
  Copy,
  CopyPlus,
  Database,
  MoreHorizontal,
  Pencil,
  Play,
  Save,
  Star,
  Trash2,
  Unplug,
  User,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { IconMenu, IconMenuContent, IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
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
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import { connectionColorLabel, type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { cn } from "@/lib/utils";
import { OpenInWindowMenuItem } from "./open-in-window-menu-item";

interface Props {
  connection: SavedConnection;
  active: boolean;
  onOpen: () => void;
  onOpenWindow?: () => void;
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
  onOpenWindow,
  onEdit,
  onDelete,
  onDuplicate,
  onCreateSimilar,
  onToggleFavorite,
  onBackup,
}: Props) {
  const favorite = Boolean(connection.favorite);
  const saveTemporary = useConnectionsStore((state) => state.saveTemporaryConnection);

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
              <IconMenu>
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
                <IconMenuContent>
                  <IconMenuItem
                    icon={<Play />}
                    label={active ? "Trennen" : "Verbinden"}
                    onSelect={onOpen}
                  />
                  {onOpenWindow && <OpenInWindowMenuItem onSelect={onOpenWindow} />}
                  <IconMenuItem icon={<Pencil />} label="Bearbeiten" onSelect={onEdit} />
                  {onBackup && (
                    <IconMenuItem
                      icon={<Archive />}
                      label="Sichern & Wiederherstellen…"
                      onSelect={onBackup}
                    />
                  )}
                  <IconMenuSeparator />
                  <IconMenuItem icon={<Copy />} label="Duplizieren" onSelect={onDuplicate} />
                  <IconMenuItem
                    icon={<CopyPlus />}
                    label="Ähnliche erstellen"
                    onSelect={onCreateSimilar}
                  />
                  <IconMenuSeparator />
                  <IconMenuItem
                    icon={<Trash2 />}
                    label="Löschen"
                    variant="destructive"
                    onSelect={onDelete}
                  />
                </IconMenuContent>
              </IconMenu>
            </div>
          }
          footer={
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
              {connection.temporary ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => saveTemporary(connection.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Save className="size-3" />
                  Verbindung speichern
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={onEdit}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3" />
                  Bearbeiten
                </Button>
              )}
              <div className="flex items-center gap-1">
                {active ? (
                  <Button variant="outline" size="xs" onClick={onOpen}>
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
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>{active ? "Trennen" : "Verbinden"}</ContextMenuItem>
        {onOpenWindow && (
          <ContextMenuItem onSelect={onOpenWindow}>In neuem Fenster öffnen</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onEdit}>Bearbeiten…</ContextMenuItem>
        {onBackup && (
          <ContextMenuItem onSelect={onBackup}>Sichern & Wiederherstellen…</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onToggleFavorite}>
          {favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDuplicate}>Duplizieren</ContextMenuItem>
        <ContextMenuItem onSelect={onCreateSimilar}>Ähnliche erstellen…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          Löschen…
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
  actions,
}: {
  connection: SavedConnection;
  checked: boolean;
  disabledReason?: string | null;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  actions?: ReactNode;
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
      title={disabledReason ?? undefined}
      actions={
        <div data-no-toggle className="flex shrink-0 items-center gap-0.5">
          {actions}
          <Checkbox
            checked={checked}
            disabled={disabled}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`${connection.name} aktivieren`}
            className="m-1.5"
          />
        </div>
      }
      footer={children}
    />
  );
}

function ConnectionCardShell({
  connection,
  active,
  actions,
  footer,
  className,
  ...rest
}: {
  connection: SavedConnection;
  active: boolean;
  actions: ReactNode;
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
      initial={reduce ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      {...rest}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-xl border bg-card p-4 transition-colors duration-150 hover:border-foreground/20",
        active ? "border-primary/40 ring-1 ring-primary/15" : "border-border/80",
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
                "relative grid size-9 shrink-0 place-items-center rounded-lg border bg-background",
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

        <div className="mt-3 text-xs">
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
      </div>

      {footer}
    </motion.article>
  );
}

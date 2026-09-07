import { ArrowUpRight, LockKeyhole, Pencil, Trash2, Unplug } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { DriverDetail } from "@/components/driver-detail";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { SPRING_LAYOUT } from "@/lib/ease";

interface Props {
  connection: SavedConnection;
  active: boolean;
  busy: boolean;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ConnectionCard({
  connection,
  active,
  busy,
  connecting,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: Props) {
  const endpoint = connectionSummary(connection.connectionString, connection.kind);
  const provider = providerFor(connection);
  const endpointLabel = endpoint.port ? `${endpoint.host}:${endpoint.port}` : endpoint.host;
  const reduce = useReducedMotion();
  return (
    <motion.article
      layout
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: SPRING_LAYOUT }}
      className={`group rounded-2xl border bg-card p-5 transition-colors ${active ? "border-primary/40 ring-1 ring-primary/10" : "hover:border-foreground/20"}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid size-10 shrink-0 place-items-center rounded-xl border bg-white p-1.5 shadow-sm ${active ? "border-primary/40 ring-1 ring-primary/10" : ""}`}
        >
          <ProviderLogo providerId={provider.id} kind={connection.kind} className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{connection.name}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {provider.name}
            {connection.ssh?.host ? " · SSH-Tunnel" : ""}
          </p>
        </div>
        <AnimatedBadge status={connecting ? "loading" : active ? "success" : "neutral"} size="sm">
          {connecting ? "Verbinden" : active ? "Aktiv" : "Gespeichert"}
        </AnimatedBadge>
      </div>
      <div className="my-4 grid grid-cols-[65px_1fr] gap-x-3 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Endpunkt</span>
        <span className="truncate font-mono" title={endpointLabel}>
          {endpointLabel}
        </span>
        <span className="text-muted-foreground">Datenbank</span>
        <span className="truncate font-mono">{endpoint.database}</span>
      </div>
      {Boolean(connection.tags?.length) && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {connection.tags?.map((tag) => (
            <span
              key={tag.name}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground"
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-t pt-3">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <LockKeyhole className="size-3" />
          {!provider.capabilities.ssl ? (
            <DriverDetail detail={provider.driver_status.detail} iconClassName="size-3" />
          ) : connection.sslMode === "disable" ? (
            "TLS deaktiviert"
          ) : (
            `TLS · ${connection.sslMode}`
          )}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`${connection.name} bearbeiten`}
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 hover:text-destructive"
            aria-label={`${connection.name} entfernen`}
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
          {active ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-1 h-7 text-xs"
              disabled={busy}
              onClick={onDisconnect}
            >
              <Unplug className="size-3" />
              Trennen
            </Button>
          ) : (
            <Button size="sm" className="ml-1 h-7 text-xs" disabled={busy} onClick={onConnect}>
              Öffnen
              <ArrowUpRight className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

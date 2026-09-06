import { Link } from "@tanstack/react-router";
import { connectionColorLabel, useActiveConnection } from "@/lib/connections";
import { cn } from "@/lib/utils";

interface Props {
  variant: "header" | "tabs" | "status";
  className?: string;
}

export function ConnectionColorBadge({ variant, className }: Props) {
  const connection = useActiveConnection();
  if (!connection) return null;
  const label = connectionColorLabel(connection.color);
  const title = label ? `${connection.name} · ${label}` : connection.name;
  const dot = (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 rounded-full",
        variant === "status" ? "size-2" : "size-2.5",
        !connection.color && "border border-muted-foreground/50",
      )}
      style={connection.color ? { backgroundColor: connection.color } : undefined}
    />
  );
  if (variant === "status") {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={title}>
        {dot}
        <span className="max-w-40 truncate">{connection.name}</span>
        {label && <span className="sr-only">Farbe {label}</span>}
      </span>
    );
  }
  if (variant === "tabs") {
    return (
      <span
        data-connection-color={connection.color ?? undefined}
        className={cn(
          "inline-flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium",
          className,
        )}
        style={
          connection.color
            ? { borderColor: connection.color, backgroundColor: `${connection.color}1a` }
            : undefined
        }
        title={title}
      >
        {dot}
        <span className="truncate">{connection.name}</span>
        {label && <span className="sr-only">Farbe {label}</span>}
      </span>
    );
  }
  return (
    <Link
      to="/connections"
      data-tour="header-connection"
      className={cn(
        "inline-flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors hover:bg-muted",
        className,
      )}
      style={
        connection.color
          ? { borderColor: connection.color, backgroundColor: `${connection.color}1a` }
          : undefined
      }
      title={title}
      aria-label={label ? `Aktive Verbindung ${connection.name}, Farbe ${label}` : `Aktive Verbindung ${connection.name}`}
    >
      {dot}
      <span className="truncate">{connection.name}</span>
      {label && <span className="hidden text-[10px] font-normal text-muted-foreground lg:inline">{label}</span>}
    </Link>
  );
}

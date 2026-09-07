import { connectionColorLabel, useActiveConnection } from "@/lib/connections";
import { cn } from "@/lib/utils";

export function ConnectionColorBadge({ className }: { className?: string }) {
  const connection = useActiveConnection();
  if (!connection) return null;
  const label = connectionColorLabel(connection.color);
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      title={label ? `${connection.name} · ${label}` : connection.name}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-2 shrink-0 rounded-full",
          !connection.color && "border border-muted-foreground/50",
        )}
        style={connection.color ? { backgroundColor: connection.color } : undefined}
      />
      <span className="max-w-40 truncate">{connection.name}</span>
      {label && <span className="sr-only">Farbe {label}</span>}
    </span>
  );
}

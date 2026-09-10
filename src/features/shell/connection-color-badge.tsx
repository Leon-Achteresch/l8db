import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { useActiveConnection } from "@/lib/connections";
import { cn } from "@/lib/utils";

export function ConnectionColorBadge({ className }: { className?: string }) {
  const connection = useActiveConnection();
  if (!connection) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <ConnectionStatusIndicator connectionId={connection.id} />
      <span className="max-w-40 truncate">{connection.name}</span>
    </span>
  );
}

import { type ConnectionStatus, connectionStatusFor } from "@/lib/connection-state";
import { useConnectionsStore } from "@/lib/connections";
import { useConnectionSwitch } from "@/lib/ssh";
import { cn } from "@/lib/utils";

interface Props {
  connectionId: string;
  showLabel?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; dot: string; pulse: boolean }> = {
  disconnected: { label: "Getrennt", dot: "bg-muted-foreground/45", pulse: false },
  connecting: { label: "Wird verbunden", dot: "bg-sky-500", pulse: true },
  connected: { label: "Verbunden", dot: "bg-emerald-500", pulse: false },
  disconnecting: { label: "Wird getrennt", dot: "bg-amber-500", pulse: true },
  error: { label: "Verbindungsfehler", dot: "bg-red-500", pulse: false },
};

export function ConnectionStatusIndicator({ connectionId, showLabel = false, className }: Props) {
  const activeId = useConnectionsStore((state) => state.activeId);
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const targetId = useConnectionSwitch((state) => state.targetId);
  const errorId = useConnectionSwitch((state) => state.errorId);
  const status = connectionStatusFor({
    connectionId,
    activeId,
    isSwitching,
    targetId,
    errorId,
  });
  const config = STATUS_CONFIG[status];

  return (
    <span
      role="img"
      aria-label={config.label}
      className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
      data-connection-status={status}
      title={config.label}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15",
          config.dot,
          config.pulse && "animate-pulse",
        )}
      />
      {showLabel && <span className="text-[10px] text-muted-foreground">{config.label}</span>}
    </span>
  );
}

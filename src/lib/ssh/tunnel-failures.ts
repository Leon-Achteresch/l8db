import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";

export interface TunnelFailure {
  id: string;
  error: string;
  fatal: boolean;
}

let watching: Promise<unknown> | null = null;

export function reportTunnelFailure(failure: TunnelFailure): void {
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === failure.id);
  const label = connection?.name ?? failure.id;
  if (!failure.fatal) {
    toast.warning(`SSH-Tunnel „${label}“ unterbrochen, neuer Versuch folgt: ${failure.error}`);
    return;
  }
  useConnectionsStore.setState((state) => ({
    connections: state.connections.map((entry) =>
      entry.id === failure.id ? { ...entry, tunnelPort: null } : entry,
    ),
  }));
  toast.error(`SSH-Tunnel „${label}“ getrennt: ${failure.error}`, { duration: Infinity });
}

export function watchTunnelFailures(): void {
  if (watching) return;
  watching = import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<TunnelFailure>("ssh-tunnel-failed", ({ payload }) => reportTunnelFailure(payload)),
    )
    .catch(() => {
      watching = null;
    });
}

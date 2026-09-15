import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { isConnectionQuery } from "@/lib/query-client";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { getTransactionForConnection } from "@/lib/transactions";
import { cn } from "@/lib/utils";

export async function disconnectActiveConnection(queryClient?: QueryClient): Promise<boolean> {
  const id = useConnectionsStore.getState().activeId;
  if (!id || useConnectionSwitch.getState().isSwitching) return false;
  if (!getTransactionForConnection(id) && queryClient) {
    await queryClient.cancelQueries({
      predicate: (query) => isConnectionQuery(query.queryKey, id),
    });
  }
  const ok = await activateConnectionWithToast(null);
  if (ok && queryClient) {
    await queryClient.cancelQueries({
      predicate: (query) => isConnectionQuery(query.queryKey, id),
    });
  }
  return ok;
}

interface Props {
  variant?: "outline" | "ghost" | "secondary";
  size?: "sm" | "xs" | "icon-sm";
  className?: string;
  showLabel?: boolean;
}

export function DisconnectButton({
  variant = "outline",
  size = "sm",
  className,
  showLabel = true,
}: Props) {
  const connection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const queryClient = useQueryClient();

  if (!connection) return null;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={isSwitching}
      onClick={() => void disconnectActiveConnection(queryClient)}
      aria-label={`Verbindung zu „${connection.name}“ trennen`}
      title={`Verbindung zu „${connection.name}“ trennen`}
      className={cn(showLabel ? "" : "px-0", className)}
    >
      <Unplug className="size-3.5" />
      {showLabel ? "Trennen" : null}
    </Button>
  );
}

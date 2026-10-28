import { RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BaasStudioFooter({
  onRefresh,
  refreshing,
  onDisconnect,
  busy,
}: {
  onRefresh: () => void;
  refreshing?: boolean;
  onDisconnect: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
        Aktualisieren
      </Button>
      <Button variant="ghost" size="sm" onClick={onDisconnect} disabled={busy}>
        <Unplug className="size-3.5" />
        Trennen
      </Button>
    </div>
  );
}

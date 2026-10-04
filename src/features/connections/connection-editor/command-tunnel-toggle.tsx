import { Terminal } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Switch } from "@/components/ui/switch";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { NetworkDraft } from "./use-network-draft";

export function CommandTunnelToggle({ network }: { network: NetworkDraft }) {
  const feature = useNewFeatureVisibility<HTMLLabelElement>("connections.editor.command-tunnel");
  return (
    <label
      ref={feature.ref}
      htmlFor="connection-command-tunnel"
      className="flex h-9 items-end justify-between gap-3 pb-0.5 text-xs font-medium sm:h-auto sm:items-center sm:self-end sm:pb-2"
    >
      <span className="flex items-center gap-2">
        <Terminal className="size-4 text-muted-foreground" /> Tunnel-Befehl
        {feature.isNew && <NewBadge />}
      </span>
      <Switch
        id="connection-command-tunnel"
        checked={network.commandEnabled}
        onCheckedChange={network.setCommandEnabled}
        aria-label="Tunnel-Befehl"
      />
    </label>
  );
}

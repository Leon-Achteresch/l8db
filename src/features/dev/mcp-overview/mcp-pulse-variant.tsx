import { ProviderLogo, ThesvgIcon } from "@/components/provider-logo";
import { Switch } from "@/components/ui/switch";
import { mcpClientSvg } from "@/features/mcp/mcp-client-icons";
import { cn } from "@/lib/utils";
import { formatAgo, type McpVariantProps } from "./data";

export function McpPulseVariant({ state, onToggleServer }: McpVariantProps) {
  const exposed = state.databases.filter((db) => db.exposed);
  const clients = state.clients.filter((client) => client.registered);
  const last = state.calls[0];
  return (
    <div className="flex flex-col items-center gap-8 py-6 text-center">
      <div className="flex items-center gap-3">
        <span className="relative flex size-3">
          {state.enabled && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
          )}
          <span
            className={cn(
              "relative inline-flex size-3 rounded-full",
              state.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
        </span>
        <span className="text-3xl font-semibold tracking-tight">
          {state.enabled ? "Aktiv" : "Pausiert"}
        </span>
        <Switch checked={state.enabled} onCheckedChange={onToggleServer} aria-label="MCP-Server" />
      </div>
      <div className="flex items-center gap-10">
        <div className="flex -space-x-2">
          {clients.map((client) => {
            const svg = mcpClientSvg(client.id);
            return (
              <span
                key={client.id}
                title={client.name}
                className="flex size-10 items-center justify-center rounded-full bg-background shadow-sm"
              >
                {svg && <ThesvgIcon svg={svg} className="size-5" />}
              </span>
            );
          })}
        </div>
        <span className="h-px w-16 bg-gradient-to-r from-transparent via-foreground/30 to-transparent" />
        <div className="flex -space-x-2">
          {exposed.map((db) => (
            <span
              key={db.id}
              title={db.name}
              className="flex size-10 items-center justify-center rounded-full bg-background shadow-sm"
            >
              <ProviderLogo kind={db.kind} className="size-5" />
            </span>
          ))}
        </div>
      </div>
      {last && (
        <p className="text-sm text-muted-foreground">
          <span className="font-mono text-foreground">{last.tool}</span> · {last.connection} ·{" "}
          {formatAgo(last.ts)}
        </p>
      )}
    </div>
  );
}

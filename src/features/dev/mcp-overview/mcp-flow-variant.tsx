import { ProviderLogo, ThesvgIcon } from "@/components/provider-logo";
import { mcpClientSvg } from "@/features/mcp/mcp-client-icons";
import { cn } from "@/lib/utils";
import type { McpVariantProps } from "./data";

export function McpFlowVariant({ state, onToggleServer, onToggleDatabase }: McpVariantProps) {
  const callsByDb = new Map<string, number>();
  for (const call of state.calls) {
    callsByDb.set(call.connection, (callsByDb.get(call.connection) ?? 0) + 1);
  }
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
      <ul className="space-y-1 justify-self-end">
        {state.clients.map((client) => {
          const svg = mcpClientSvg(client.id);
          return (
            <li
              key={client.id}
              className={cn(
                "flex items-center justify-end gap-3 rounded-lg px-3 py-2 text-sm",
                !client.registered && "opacity-35",
              )}
            >
              {client.name}
              {svg && <ThesvgIcon svg={svg} className="size-5" />}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onToggleServer}
        className={cn(
          "flex size-24 cursor-pointer flex-col items-center justify-center rounded-full text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          state.enabled
            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
            : "bg-muted text-muted-foreground",
        )}
      >
        l8db
        <span className="text-[11px] font-normal opacity-80">
          {state.enabled ? "läuft" : "aus"}
        </span>
      </button>
      <ul className="space-y-1">
        {state.databases.map((db) => (
          <li key={db.id}>
            <button
              type="button"
              onClick={() => onToggleDatabase(db.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                !db.exposed && "opacity-35",
              )}
            >
              <ProviderLogo kind={db.kind} className="size-5" />
              {db.name}
              {db.exposed && (
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                  {callsByDb.get(db.name) ?? 0}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

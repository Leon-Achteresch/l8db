import { ThesvgIcon } from "@/components/provider-logo";
import { mcpClientSvg } from "@/features/mcp/mcp-client-icons";
import { cn } from "@/lib/utils";
import type { LabClient } from "./data";

interface McpStudioClientsProps {
  clients: LabClient[];
  onToggle: (id: string) => void;
}

export function McpStudioClients({ clients, onToggle }: McpStudioClientsProps) {
  return (
    <ul className="space-y-0.5">
      {clients.map((client) => {
        const svg = mcpClientSvg(client.id);
        return (
          <li key={client.id}>
            <button
              type="button"
              onClick={() => onToggle(client.id)}
              aria-pressed={client.registered}
              className={cn(
                "flex w-full cursor-pointer items-center justify-end gap-3 rounded-lg px-3 py-2 text-sm transition-opacity hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                !client.registered && "opacity-40 hover:opacity-80",
              )}
            >
              {client.name}
              {svg && <ThesvgIcon svg={svg} className="size-5" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

import { Terminal } from "lucide-react";
import { McpClientCard } from "@/features/mcp/mcp-client-card";
import { McpCommandBox } from "@/features/mcp/mcp-command-box";
import { McpEmptyState } from "@/features/mcp/mcp-empty-state";
import type { McpClient } from "@/lib/mcp";

interface McpClientsSectionProps {
  clients: McpClient[];
  command: string;
  isInitialSetup?: boolean;
  onToggleClient: (client: McpClient) => void;
}

export function McpClientsSection({
  clients,
  command,
  isInitialSetup,
  onToggleClient,
}: McpClientsSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            KI-Assistenten & Editoren
          </h2>
          {isInitialSetup ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Empfohlener Start
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Registriere den l8db MCP-Server mit einem Klick in deinen lokalen Entwicklungswerkzeugen.
          Beim Eintragen wird automatisch ein Backup der Konfigurationsdatei (.bak) erstellt.
        </p>
      </div>

      {clients.length === 0 ? (
        <McpEmptyState
          icon={Terminal}
          title="Keine unterstützten Clients gefunden"
          description="Installiere Claude Desktop, Cursor oder andere MCP-fähige Werkzeuge."
        />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <McpClientCard
              key={client.id}
              client={client}
              onToggle={() => onToggleClient(client)}
            />
          ))}
        </div>
      )}

      {command ? <McpCommandBox command={command} /> : null}
    </section>
  );
}

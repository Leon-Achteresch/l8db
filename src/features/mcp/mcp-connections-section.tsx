import { Database, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { McpConnectionCard } from "@/features/mcp/mcp-connection-card";
import { McpEmptyState } from "@/features/mcp/mcp-empty-state";
import { groupByServer } from "@/lib/connection-groups";
import { useConnectionsStore } from "@/lib/connections";
import type { McpConnection } from "@/lib/mcp";

interface McpConnectionsSectionProps {
  connections: McpConnection[];
  isInitialSetup?: boolean;
  onUpdateConnection: (id: string, patch: Partial<McpConnection>) => void;
}

export function McpConnectionsSection({
  connections,
  isInitialSetup,
  onUpdateConnection,
}: McpConnectionsSectionProps) {
  const [search, setSearch] = useState("");
  const [onlyExposed, setOnlyExposed] = useState(false);
  const hostGroupRules = useConnectionsStore((state) => state.hostGroupRules);

  const filtered = useMemo(() => {
    return connections.filter((conn) => {
      if (onlyExposed && !conn.exposed) return false;
      if (!search.trim()) return true;
      const term = search.toLowerCase();
      return (
        conn.name.toLowerCase().includes(term) ||
        conn.kind.toLowerCase().includes(term) ||
        conn.connectionString.toLowerCase().includes(term)
      );
    });
  }, [connections, search, onlyExposed]);

  const groups = useMemo(
    () =>
      groupByServer(
        [...filtered].sort((a, b) => a.name.localeCompare(b.name)),
        hostGroupRules,
      ).sort((a, b) => a.label.localeCompare(b.label)),
    [filtered, hostGroupRules],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Datenbank-Verbindungen
            </h2>
            {isInitialSetup ? (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                Aktion erforderlich
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Wähle aus, welche deiner gespeicherten Verbindungen für den MCP-Server freigegeben
            werden.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Verbindung suchen…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant={onlyExposed ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => setOnlyExposed((prev) => !prev)}
          >
            <Filter className="size-3.5" />
            {onlyExposed ? "Nur Freigegebene" : "Alle"}
          </Button>
        </div>
      </div>

      {connections.length === 0 ? (
        <McpEmptyState
          icon={Database}
          title="Keine Verbindungen vorhanden"
          description="Erstelle zuerst eine Datenbankverbindung in l8db, um sie hier freigeben zu können."
        />
      ) : filtered.length === 0 ? (
        <McpEmptyState
          icon={Search}
          title="Keine Treffer gefunden"
          description="Passe deine Suche oder deinen Filter an, um gespeicherte Verbindungen zu sehen."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setOnlyExposed(false);
              }}
            >
              Filter zurücksetzen
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2.5">
              <div className="flex items-center gap-2 px-1">
                <ProviderLogo kind={group.kind} className="size-4" />
                <span className="truncate text-sm font-semibold text-foreground">
                  {group.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {group.connections.filter((entry) => entry.exposed).length}/
                  {group.connections.length} freigegeben
                </span>
              </div>
              <div className="grid gap-3.5 xl:grid-cols-2">
                {group.connections.map((connection) => (
                  <McpConnectionCard
                    key={connection.id}
                    connection={connection}
                    onUpdate={(patch) => onUpdateConnection(connection.id, patch)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

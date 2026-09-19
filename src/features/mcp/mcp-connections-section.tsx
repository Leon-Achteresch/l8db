import { Database, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectionSelectCard } from "@/features/connections/connection-pick-card";
import { ConnectionsGroupedLayout } from "@/features/connections/connections-view/grouped-layout";
import { ServerGroupSection } from "@/features/connections/connections-view/server-group-section";
import { McpConnectionSettings } from "@/features/mcp/mcp-connection-settings";
import { McpEmptyState } from "@/features/mcp/mcp-empty-state";
import {
  groupByServer,
  matchesConnectionQuery,
  type ServerGroup,
  sortServerGroups,
} from "@/lib/connection-groups";
import { sortConnectionsByName, useConnectionsStore } from "@/lib/connections";
import { type McpConnection, mcpConnectionUnsupported } from "@/lib/mcp";

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
  const [selectedKey, setSelectedKey] = useState("all");
  const saved = useConnectionsStore((state) => state.connections);
  const hostGroupRules = useConnectionsStore((state) => state.hostGroupRules);
  const favoriteServerKeys = useConnectionsStore((state) => state.favoriteServerKeys);
  const serverOrder = useConnectionsStore((state) => state.serverOrder);

  const byId = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const filtered = useMemo(
    () =>
      sortConnectionsByName(
        saved.filter((connection) => {
          const mcp = byId.get(connection.id);
          if (!mcp || (onlyExposed && !mcp.exposed)) return false;
          return matchesConnectionQuery(connection, search);
        }),
      ),
    [saved, byId, onlyExposed, search],
  );
  const groups = sortServerGroups(
    groupByServer(filtered, hostGroupRules),
    favoriteServerKeys,
    serverOrder,
  );
  const effectiveKey =
    selectedKey === "all" || groups.some((group) => group.key === selectedKey)
      ? selectedKey
      : "all";
  const displayGroups =
    effectiveKey === "all" ? groups : groups.filter((group) => group.key === effectiveKey);

  function renderGroup(group: ServerGroup) {
    return (
      <ServerGroupSection
        key={group.key}
        group={group}
        favorite={favoriteServerKeys.includes(group.key)}
      >
        {group.connections.map((connection) => {
          const mcp = byId.get(connection.id);
          if (!mcp) return null;
          return (
            <ConnectionSelectCard
              key={connection.id}
              connection={connection}
              checked={mcp.exposed}
              disabledReason={mcpConnectionUnsupported(mcp)}
              onCheckedChange={(exposed) => onUpdateConnection(connection.id, { exposed })}
            >
              {mcp.exposed ? (
                <McpConnectionSettings
                  connection={mcp}
                  onUpdate={(patch) => onUpdateConnection(connection.id, patch)}
                />
              ) : null}
            </ConnectionSelectCard>
          );
        })}
      </ServerGroupSection>
    );
  }

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
        <ConnectionsGroupedLayout
          groups={groups}
          effectiveKey={effectiveKey}
          filtered={filtered}
          favoriteServerKeys={favoriteServerKeys}
          activeGroupKey={null}
          setSelectedKey={setSelectedKey}
          displayGroups={displayGroups}
          renderGroup={renderGroup}
        />
      )}
    </section>
  );
}

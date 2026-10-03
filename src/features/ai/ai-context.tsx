import type { StoredServer } from "@/lib/ai/store";
import type { SavedConnection } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface Props {
  connections: SavedConnection[];
  activeId: string | null;
  mentioned: string[];
  setMentioned: (ids: string[]) => void;
  skills: { name: string; path: string }[];
  selectedSkills: string[];
  setSelectedSkills: (paths: string[]) => void;
  servers: StoredServer[];
  selectedServers: string[];
  setSelectedServers: (ids: string[]) => void;
  allowWrites: boolean;
  setAllowWrites: (allow: boolean) => void;
  allowDdl: boolean;
  setAllowDdl: (allow: boolean) => void;
  disabled: boolean;
  part?: "connections" | "tools";
}
export function AiContext({
  connections,
  activeId,
  mentioned,
  setMentioned,
  skills,
  selectedSkills,
  setSelectedSkills,
  servers,
  selectedServers,
  setSelectedServers,
  allowWrites,
  setAllowWrites,
  allowDdl,
  setAllowDdl,
  disabled,
  part,
}: Props) {
  const connectionsFeature = useNewFeatureVisibility<HTMLDivElement>("ai.context.connections");
  const skillsFeature = useNewFeatureVisibility<HTMLDivElement>("ai.context.skills");
  const toggle = (entries: string[], id: string) =>
    entries.includes(id) ? entries.filter((entry) => entry !== id) : [...entries, id];
  return (
    <div className="max-h-[65vh] space-y-4 overflow-auto px-4 py-3 text-xs">
      {part !== "tools" && (
        <div ref={connectionsFeature.ref}>
          <h3 className="mb-2 font-medium">Verbindungen</h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Die aktive Datenbank wird bei jeder Nachricht aktualisiert. Zusätzliche Verbindungen
            explizit auswählen.
          </p>
          <div className="space-y-2">
            {connections.map((connection) => (
              <label key={connection.id} className="flex min-h-8 items-center gap-2">
                <input
                  type="checkbox"
                  disabled={disabled || connection.id === activeId}
                  checked={connection.id === activeId || mentioned.includes(connection.id)}
                  onChange={() => setMentioned(toggle(mentioned, connection.id))}
                />
                <span className="truncate">@{connection.name}</span>
                {connection.id === activeId && (
                  <span className="ml-auto text-[10px] text-muted-foreground">aktiv</span>
                )}
              </label>
            ))}
            {connections.length === 0 && (
              <p className="text-muted-foreground">Noch keine Verbindungen vorhanden.</p>
            )}
          </div>
        </div>
      )}
      {part !== "connections" && (
        <>
          <div ref={skillsFeature.ref}>
            <h3 className="mb-2 font-medium">Skills</h3>
            <div className="space-y-2">
              {skills.map((skill) => (
                <label
                  key={skill.path}
                  className="flex min-h-8 items-center gap-2"
                  title={skill.path}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selectedSkills.includes(skill.path)}
                    onChange={() => setSelectedSkills(toggle(selectedSkills, skill.path))}
                  />
                  <span className="truncate">{skill.name}</span>
                </label>
              ))}
              {!skills.length && (
                <p className="text-muted-foreground">
                  Keine zusätzlichen lokalen Skills gefunden. Native Skills bleiben verfügbar.
                </p>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Zusätzliche MCP-Server</h3>
            {servers
              .filter((server) => !server.deleted)
              .map((server) => (
                <label key={server.id} className="mb-2 flex min-h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selectedServers.includes(server.id)}
                    onChange={() => setSelectedServers(toggle(selectedServers, server.id))}
                  />
                  <span>{server.name}</span>
                </label>
              ))}
            {!servers.some((server) => !server.deleted) && (
              <p className="text-muted-foreground">Server unter Einstellungen hinzufügen.</p>
            )}
          </div>
          <div className="space-y-2 border-t pt-3">
            <label className="flex min-h-8 items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={allowWrites}
                onChange={(event) => {
                  setAllowWrites(event.target.checked);
                  if (!event.target.checked) setAllowDdl(false);
                }}
              />
              Datenänderungen erlauben
            </label>
            <label className="flex min-h-8 items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled || !allowWrites}
                checked={allowDdl}
                onChange={(event) => setAllowDdl(event.target.checked)}
              />
              Schemaänderungen erlauben
            </label>
            <p className="text-[11px] text-muted-foreground">
              Verbindungsschutz, Produktionssperren und Maskierung gelten weiterhin.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

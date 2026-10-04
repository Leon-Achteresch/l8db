import { Plug, Sparkles } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import type { StoredServer } from "@/lib/ai/store";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { AiContextRow as Row } from "./ai-context-row";

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
  disabled: boolean;
  part: "connections" | "tools";
}

const heading =
  "px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase";
const empty = "px-2 py-2 text-[11px] text-muted-foreground";

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
  disabled,
  part,
}: Props) {
  const connectionsFeature = useNewFeatureVisibility<HTMLDivElement>("ai.context.connections");
  const skillsFeature = useNewFeatureVisibility<HTMLDivElement>("ai.context.skills");
  const toggle = (entries: string[], id: string) =>
    entries.includes(id) ? entries.filter((entry) => entry !== id) : [...entries, id];
  const visibleServers = servers.filter((server) => !server.deleted);
  if (part === "connections")
    return (
      <div ref={connectionsFeature.ref} className="max-h-[65vh] overflow-auto p-1.5">
        <p className={heading}>Verbindungen</p>
        {connections.map((connection) => {
          const active = connection.id === activeId;
          const provider = providerFor(connection);
          return (
            <Row
              key={connection.id}
              icon={
                <ProviderLogo
                  providerId={provider.id}
                  kind={connection.kind}
                  className="size-3.5"
                />
              }
              label={connection.name}
              hint={active ? `${provider.name} · aktiv` : provider.name}
              checked={active || mentioned.includes(connection.id)}
              disabled={disabled || active}
              onToggle={() => setMentioned(toggle(mentioned, connection.id))}
            />
          );
        })}
        {connections.length === 0 && <p className={empty}>Noch keine Verbindungen vorhanden.</p>}
        <p className="mt-1 border-t px-2 pt-2 pb-1 text-[10px] text-muted-foreground">
          Die aktive Verbindung ist immer dabei.
        </p>
      </div>
    );
  return (
    <div className="max-h-[65vh] overflow-auto p-1.5">
      <div ref={skillsFeature.ref}>
        <p className={heading}>Skills</p>
        {skills.map((skill) => (
          <Row
            key={skill.path}
            icon={<Sparkles className="size-3.5 text-muted-foreground" />}
            label={skill.name}
            title={skill.path}
            checked={selectedSkills.includes(skill.path)}
            disabled={disabled}
            onToggle={() => setSelectedSkills(toggle(selectedSkills, skill.path))}
          />
        ))}
        {!skills.length && <p className={empty}>Keine lokalen Skills gefunden.</p>}
      </div>
      <p className={cn(heading, "mt-1 border-t pt-2.5")}>MCP-Server</p>
      {visibleServers.map((server) => (
        <Row
          key={server.id}
          icon={<Plug className="size-3.5 text-muted-foreground" />}
          label={server.name}
          checked={selectedServers.includes(server.id)}
          disabled={disabled}
          onToggle={() => setSelectedServers(toggle(selectedServers, server.id))}
        />
      ))}
      {!visibleServers.length && <p className={empty}>Server unter Einstellungen hinzufügen.</p>}
    </div>
  );
}

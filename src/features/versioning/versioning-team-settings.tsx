import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnectionsStore } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { readTargets, saveTargets } from "@/lib/versioning/repository";
import { changedFiles } from "@/lib/versioning/status";
import { bindTeamConnection } from "@/lib/versioning/targets";
import { TEAM_PATH } from "@/lib/versioning/team";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningSelect } from "./versioning-select";

export function VersioningTeamSettings({ workspace }: { workspace: VersioningWorkspace }) {
  const connections = useConnectionsStore((state) => state.connections);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("Update shared database team configuration");
  const feature = useNewFeatureVisibility<HTMLDivElement>("versioning.targets.team");
  const { project, targets } = workspace;
  if (!project || !targets) return null;
  const pending = changedFiles(workspace.status?.changes ?? "").has(TEAM_PATH);
  return (
    <div ref={feature.ref} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        Teamkonfiguration in Git {feature.isNew && <NewBadge />}
      </h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Kunden, Umgebungen, Verbindungsreferenzen, Update-Regeln und Branch-Zuordnungen werden in
        database/team.json geteilt. Zugangsdaten bleiben im Schlüsselbund. Jedes Teammitglied ordnet
        die gemeinsamen Verbindungen seinen lokalen Profilen zu.
      </p>
      {!targets.teamConfigured && (
        <Button
          size="sm"
          onClick={() =>
            void workspace.run(async () => {
              const current = await readTargets(workspace.repo, project.id);
              await saveTargets(workspace.repo, current.store, current.text);
              await workspace.refresh();
            }, "Teamkonfiguration in Git übernommen. Änderungen prüfen und committen.")
          }
        >
          Bestehende Zuordnungen in Git übernehmen
        </Button>
      )}
      {(targets.connections ?? []).map((connection) => {
        const localId =
          selection[connection.id] ?? targets.connectionBindings?.[connection.id] ?? "";
        return (
          <div key={connection.id} className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium">{connection.name}</p>
            <p className="break-words font-mono text-[11px] text-muted-foreground">
              {connection.host}:{connection.port}
              {connection.service ? ` / ${connection.service}` : ""}
              {connection.requiresTunnel ? " · Tunnel erforderlich" : ""}
            </p>
            <VersioningSelect
              label={`Lokales Profil: ${connection.name}`}
              value={localId}
              onChange={(id) => setSelection((current) => ({ ...current, [connection.id]: id }))}
              placeholder="Lokales Verbindungsprofil zuordnen"
              options={connections
                .filter((entry) => entry.kind === connection.kind)
                .map((entry) => ({ value: entry.id, label: entry.name }))}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!localId}
              onClick={() =>
                void workspace.run(async () => {
                  const local = connections.find((entry) => entry.id === localId);
                  if (!local) throw new Error("Lokales Verbindungsprofil fehlt.");
                  await bindTeamConnection(
                    workspace.repo,
                    project,
                    connection.id,
                    local,
                    connections,
                  );
                  await workspace.refresh();
                }, "Lokales Profil geprüft und zugeordnet")
              }
            >
              Profil prüfen und lokal zuordnen
            </Button>
          </div>
        );
      })}
      {pending && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium">Teamkonfiguration enthält offene Git-Änderungen</p>
          <Input
            aria-label="Teamkonfiguration Commit-Nachricht"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button
            size="sm"
            disabled={!message.trim()}
            onClick={() =>
              void workspace.run(
                () => workspace.git("commit", message.trim(), [TEAM_PATH]),
                "Teamkonfiguration committet",
              )
            }
          >
            Teamkonfiguration committen
          </Button>
        </div>
      )}
    </div>
  );
}

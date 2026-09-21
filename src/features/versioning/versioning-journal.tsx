import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConnectionsStore } from "@/lib/connections";
import { control, type JournalEntry } from "@/lib/versioning/control";
import type { DatabaseTarget } from "@/lib/versioning/types";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningReviewArtifact } from "./versioning-review-artifact";
import { VersioningSelect } from "./versioning-select";

function content(entry: JournalEntry): string {
  try {
    const value: unknown = JSON.parse(entry.BODY);
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return entry.BODY;
  }
}

export function VersioningJournal({
  workspace,
  target,
}: {
  workspace: VersioningWorkspace;
  target: DatabaseTarget;
}) {
  const connections = useConnectionsStore((state) => state.connections);
  const [connectionId, setConnectionId] = useState(target.connectionId);
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const project = workspace.project;
  const connection = connections.find((item) => item.id === connectionId);
  const refresh = async () => {
    if (!connection || !project) throw new Error("Verbindung fehlt.");
    setEntries(await control<JournalEntry[]>(connection, project, target, "journal"));
  };
  return (
    <details className="py-3">
      <summary className="cursor-pointer text-xs font-medium">
        {target.name} · Datenbankjournal
      </summary>
      <div className="mt-3 space-y-3">
        <VersioningSelect
          label={`Journal-Verbindung: ${target.name}`}
          value={connectionId}
          onChange={(value) => {
            setConnectionId(value);
            setEntries(null);
          }}
          options={connections
            .filter((item) => item.kind === project?.kind)
            .map((item) => ({ value: item.id, label: item.name }))}
        />
        <p className="text-[11px] text-muted-foreground">
          Für Freigaben eine Verbindung zum selben Ziel mit einem anderen DB-Benutzer wählen. Das
          Journal bleibt auch ohne dieses lokale Repository erhalten.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={workspace.busy}
          onClick={() => void workspace.run(refresh)}
        >
          Journal laden
        </Button>
        {entries?.length === 0 && <p className="text-xs text-muted-foreground">Keine Einträge.</p>}
        {entries?.map((entry) => (
          <details key={entry.ENTRY_ID} className="py-2 text-xs">
            <summary className="cursor-pointer">
              {entry.EVENT} · {entry.ACTOR}
              <span className="ml-2 text-muted-foreground">{entry.CREATED_AT}</span>
            </summary>
            {entry.EVENT === "review_requested" ? (
              <VersioningReviewArtifact content={content(entry)} />
            ) : (
              <pre className="my-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-[11px]">
                {content(entry)}
              </pre>
            )}
            {entry.EVENT === "review_requested" && (
              <Button
                size="sm"
                disabled={workspace.busy}
                onClick={() =>
                  void workspace.run(async () => {
                    if (!connection || !project) throw new Error("Verbindung fehlt.");
                    await control(connection, project, target, "approve", {
                      artifact: entry.RUN_ID,
                    });
                    await refresh();
                  }, "Geprüften Rollout freigegeben")
                }
              >
                Geprüften Rollout freigeben
              </Button>
            )}
          </details>
        ))}
        {entries?.length === 500 && (
          <p className="text-xs text-muted-foreground">
            Die neuesten 500 Einträge werden angezeigt.
          </p>
        )}
      </div>
    </details>
  );
}

import { useConnectionsStore } from "@/lib/connections";
import { NETWORK_SECRET_SUFFIXES } from "@/lib/connections/store";
import { teamConnections } from "@/lib/db/team";
import { deleteSecret } from "@/lib/secrets";
import { mergeTeamConnections, type TeamMerge } from "./merge";
import { useTeamStore } from "./store";

export const TEAM_HUB = "file";
export const FOCUS_SYNC_MS = 60_000;
export const MISSING_RECHECK_MS = 2_000;

let running: Promise<TeamMerge> | null = null;

export function teamErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pull(): Promise<TeamMerge> {
  try {
    let file = await teamConnections();
    if (
      file?.exists === false &&
      useConnectionsStore.getState().connections.some((connection) => connection.team)
    ) {
      await new Promise((resolve) => setTimeout(resolve, MISSING_RECHECK_MS));
      file = await teamConnections();
    }
    if (!Array.isArray(file?.connections))
      throw new Error("Ungültige Antwort beim Lesen der Team-Datei.");
    const store = useConnectionsStore.getState();
    const legacy = store.connections
      .filter((connection) => connection.team && connection.team.hub !== TEAM_HUB)
      .map((connection) => connection.id);
    const merge = mergeTeamConnections(store.connections, TEAM_HUB, file.connections);
    merge.removed.push(...legacy);
    if (merge.added || merge.updated || merge.removed.length)
      useConnectionsStore.setState({
        connections: merge.connections.filter((connection) => !legacy.includes(connection.id)),
      });
    for (const id of merge.removed) store.removeConnection(id);
    for (const id of merge.retargeted)
      for (const suffix of ["", ...NETWORK_SECRET_SUFFIXES])
        void deleteSecret(`${id}${suffix}`).catch(() => undefined);
    const names = new Map(merge.connections.map((connection) => [connection.id, connection.name]));
    useTeamStore.setState({
      path: file.path,
      exists: file.exists,
      warnings: [
        ...(legacy.length
          ? [
              `${legacy.length} Verbindungen aus dem früheren Team-Hub bzw. Microsoft 365 wurden entfernt, samt gespeicherter Passwörter.`,
            ]
          : []),
        ...merge.warnings,
        ...merge.retargeted.map(
          (id) =>
            `„${names.get(id) ?? id}“ zeigt jetzt auf ein anderes Ziel. Gespeicherte Passwörter wurden gelöscht; beim nächsten Verbinden fragt l8db neu.`,
        ),
      ],
      lastSyncAt: Date.now(),
      lastError: null,
    });
    return merge;
  } catch (error) {
    useTeamStore.setState({ lastError: teamErrorText(error), lastSyncAt: Date.now() });
    throw error;
  }
}

export function syncTeam(): Promise<TeamMerge> {
  if (running) return running;
  const current = pull().finally(() => {
    if (running === current) running = null;
  });
  running = current;
  return current;
}

let watching = false;

function watchFocus(): void {
  if (watching || typeof window.addEventListener !== "function") return;
  watching = true;
  window.addEventListener("focus", () => {
    if (Date.now() - (useTeamStore.getState().lastSyncAt ?? 0) > FOCUS_SYNC_MS)
      void syncTeam().catch(() => undefined);
  });
}

export async function initTeam(main = true): Promise<void> {
  if (!main) return;
  watchFocus();
  await syncTeam().catch(() => undefined);
}

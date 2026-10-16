import { useConnectionsStore } from "@/lib/connections";
import { teamConnections, teamLogin, teamLogout } from "@/lib/db/team";
import { mergeTeamConnections, normalizeHubUrl, type TeamMerge } from "./merge";
import { useTeamStore } from "./store";

let running: Promise<TeamMerge | null> | null = null;
let generation = 0;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pull(): Promise<TeamMerge | null> {
  const { hubUrl, user } = useTeamStore.getState();
  if (!hubUrl || !user) return null;
  const started = generation;
  try {
    const payload = await teamConnections(hubUrl);
    if (started !== generation) return null;
    if (!Array.isArray(payload?.connections)) throw new Error("Ungültige Antwort vom Team-Hub.");
    const store = useConnectionsStore.getState();
    const merge = mergeTeamConnections(store.connections, hubUrl, payload.connections);
    if (merge.added || merge.updated || merge.removed.length)
      useConnectionsStore.setState({ connections: merge.connections });
    for (const id of merge.removed) store.removeConnection(id);
    useTeamStore.setState({
      name: payload.name ?? null,
      user: payload.user ?? user,
      lastSyncAt: Date.now(),
      lastError: null,
    });
    return merge;
  } catch (error) {
    if (started === generation) useTeamStore.setState({ lastError: message(error) });
    throw error;
  }
}

export function syncTeam(): Promise<TeamMerge | null> {
  if (running) return running;
  const current = pull().finally(() => {
    if (running === current) running = null;
  });
  running = current;
  return current;
}

export async function loginTeam(hubUrl: string): Promise<TeamMerge | null> {
  const hub = normalizeHubUrl(hubUrl);
  const user = await teamLogin(hub);
  generation++;
  running = null;
  useTeamStore.setState({ hubUrl: hub, user, lastError: null });
  return syncTeam();
}

export async function logoutTeam(): Promise<void> {
  generation++;
  const { hubUrl } = useTeamStore.getState();
  if (hubUrl) await teamLogout(hubUrl).catch(() => undefined);
  const store = useConnectionsStore.getState();
  for (const connection of store.connections)
    if (connection.team?.hub === hubUrl) store.removeConnection(connection.id);
  useTeamStore.setState({ user: null, name: null, lastSyncAt: null, lastError: null });
}

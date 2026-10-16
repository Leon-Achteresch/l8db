import { useConnectionsStore } from "@/lib/connections";
import { teamConnections, teamLogin, teamLogout, teamManagedHub } from "@/lib/db/team";
import { mergeTeamConnections, type TeamMerge } from "./merge";
import { useTeamStore } from "./store";

export const TEAM_LOGIN_CANCELLED = "Anmeldung abgebrochen.";
export const TEAM_LOGIN_EXPIRED = "Team-Anmeldung abgelaufen. Bitte erneut anmelden.";

let running: Promise<TeamMerge | null> | null = null;
let generation = 0;

export function teamErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isLoginCancelled(error: unknown): boolean {
  return teamErrorText(error) === TEAM_LOGIN_CANCELLED;
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
    if (started === generation) useTeamStore.setState({ lastError: teamErrorText(error) });
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
  const { hub, user } = await teamLogin(hubUrl.trim());
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

export async function initTeam(main = true): Promise<void> {
  const managed = await teamManagedHub().catch((error) => {
    console.warn(`Team-Hub-Datei ungültig: ${teamErrorText(error)}`);
    return null;
  });
  if (!main) {
    useTeamStore.setState({ managedHub: managed?.url ?? null });
    return;
  }
  if (!managed) {
    useTeamStore.setState({ managedHub: null });
    await syncTeam().catch(() => undefined);
    return;
  }
  const hub = managed.url;
  const { hubUrl, user } = useTeamStore.getState();
  if (user && hubUrl !== hub) await logoutTeam();
  useTeamStore.setState({ managedHub: hub, hubUrl: hub });
  if (!useTeamStore.getState().user) {
    useTeamStore.setState({ promptOpen: true });
    return;
  }
  await syncTeam().catch((error) => {
    if (teamErrorText(error) === TEAM_LOGIN_EXPIRED) useTeamStore.setState({ promptOpen: true });
  });
}

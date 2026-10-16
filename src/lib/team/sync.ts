import { useConnectionsStore } from "@/lib/connections";
import { NETWORK_SECRET_SUFFIXES } from "@/lib/connections/store";
import { teamConnections, teamLogin, teamLogout, teamManagedHub } from "@/lib/db/team";
import { deleteSecret } from "@/lib/secrets";
import { mergeTeamConnections, type TeamMerge } from "./merge";
import { useTeamStore } from "./store";

export const MICROSOFT_HUB = "m365";
export const TEAM_CONSENT_REQUIRED = "Deine IT muss l8db einmal für eure Organisation freigeben.";
export const TEAM_LOGIN_CANCELLED = "Anmeldung abgebrochen.";
export const TEAM_LOGIN_EXPIRED = "Team-Anmeldung abgelaufen. Bitte erneut anmelden.";

export const OFFBOARDING_DAYS = 14;

let running: Promise<TeamMerge | null> | null = null;
let generation = 0;

export function teamErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isLoginCancelled(error: unknown): boolean {
  return teamErrorText(error) === TEAM_LOGIN_CANCELLED;
}

function assertPolicy(): void {
  const { policyError } = useTeamStore.getState();
  if (policyError) throw new Error(`Die Richtlinie deiner IT ist fehlerhaft: ${policyError}`);
}

async function pull(): Promise<TeamMerge | null> {
  const { hubUrl, user } = useTeamStore.getState();
  if (!hubUrl || !user) return null;
  assertPolicy();
  const started = generation;
  try {
    const payload = await teamConnections(hubUrl);
    if (started !== generation) return null;
    if (!Array.isArray(payload?.connections)) throw new Error("Ungültige Antwort vom Team-Hub.");
    const store = useConnectionsStore.getState();
    const merge = mergeTeamConnections(
      store.connections,
      hubUrl,
      payload.connections,
      useTeamStore.getState().allowedHosts,
    );
    if (payload.complete === false) {
      const keep = new Set(merge.removed);
      merge.connections.push(...store.connections.filter((connection) => keep.has(connection.id)));
      merge.removed = [];
    }
    if (merge.added || merge.updated || merge.removed.length)
      useConnectionsStore.setState({ connections: merge.connections });
    for (const id of merge.removed) store.removeConnection(id);
    for (const id of merge.retargeted)
      for (const suffix of ["", ...NETWORK_SECRET_SUFFIXES])
        void deleteSecret(`${id}${suffix}`).catch(() => undefined);
    const names = new Map(merge.connections.map((connection) => [connection.id, connection.name]));
    useTeamStore.setState({
      name: payload.name ?? null,
      url: payload.url ?? null,
      warnings: [
        ...(payload.warnings ?? []),
        ...merge.warnings,
        ...merge.retargeted.map(
          (id) =>
            `„${names.get(id) ?? id}“ zeigt jetzt auf ein anderes Ziel. Gespeicherte Passwörter wurden gelöscht; beim nächsten Verbinden fragt l8db neu.`,
        ),
      ],
      user: payload.user ?? user,
      lastSyncAt: Date.now(),
      lastError: null,
      expiredSince: null,
    });
    return merge;
  } catch (error) {
    if (started !== generation) throw error;
    useTeamStore.setState({ lastError: teamErrorText(error) });
    if (teamErrorText(error) === TEAM_LOGIN_EXPIRED) {
      const since = useTeamStore.getState().expiredSince ?? Date.now();
      useTeamStore.setState({ expiredSince: since });
      if (Date.now() - since > OFFBOARDING_DAYS * 86_400_000) await logoutTeam();
    }
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

export function needsConsent(error: unknown): boolean {
  return teamErrorText(error).startsWith(TEAM_CONSENT_REQUIRED);
}

export async function loginTeam(hubUrl: string, admin = false): Promise<TeamMerge | null> {
  assertPolicy();
  const { hub, user } = await teamLogin(hubUrl.trim(), admin);
  generation++;
  running = null;
  useTeamStore.setState({ hubUrl: hub, user, lastError: null, expiredSince: null });
  return syncTeam();
}

export async function logoutTeam(): Promise<void> {
  generation++;
  const { hubUrl } = useTeamStore.getState();
  if (hubUrl) await teamLogout(hubUrl).catch(() => undefined);
  const store = useConnectionsStore.getState();
  for (const connection of store.connections)
    if (connection.team?.hub === hubUrl) store.removeConnection(connection.id);
  useTeamStore.setState({
    user: null,
    name: null,
    lastSyncAt: null,
    lastError: null,
    warnings: [],
    url: null,
    expiredSince: null,
  });
}

export const FOCUS_SYNC_MS = 60 * 60 * 1000;

let watching = false;

function watchFocus(): void {
  if (watching || typeof window.addEventListener !== "function") return;
  watching = true;
  window.addEventListener("focus", () => {
    const { user, lastSyncAt } = useTeamStore.getState();
    if (user && Date.now() - (lastSyncAt ?? 0) > FOCUS_SYNC_MS)
      void syncTeam().catch(() => undefined);
  });
}

export async function initTeam(main = true): Promise<void> {
  let managed: Awaited<ReturnType<typeof teamManagedHub>> = null;
  try {
    managed = await teamManagedHub();
    useTeamStore.setState({ policyError: null });
  } catch (error) {
    useTeamStore.setState({
      policyError: teamErrorText(error),
      managedHub: null,
      allowedHosts: [],
      promptOpen: false,
    });
    return;
  }
  useTeamStore.setState({ allowedHosts: managed?.allowedHosts ?? [] });
  if (!main) {
    useTeamStore.setState({ managedHub: managed?.url || null });
    return;
  }
  watchFocus();
  if (!managed?.url) {
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

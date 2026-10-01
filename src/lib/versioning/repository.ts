import { useConnectionsStore } from "@/lib/connections";
import { versioningRepository } from "@/lib/db";
import {
  PROJECT_PATH,
  parseProject,
  parseRelease,
  releasePath,
  validateReleaseGraph,
} from "./model";
import {
  createTeamConfiguration,
  mergeTeamTargets,
  parseTeamConfiguration,
  TEAM_PATH,
} from "./team";
import type {
  DatabaseRelease,
  ReleaseReference,
  RepositoryStatus,
  TargetStore,
  VersioningProject,
} from "./types";

export const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function readFile(
  repo: string,
  path: string,
  revision?: string,
): Promise<string | null> {
  return versioningRepository({ action: "read", repo, path, revision });
}

export async function saveFile(
  repo: string,
  path: string,
  content: string,
  expected: string | null,
): Promise<void> {
  await versioningRepository({ action: "write", repo, path, content, expected });
}

export async function deleteFile(repo: string, path: string, expected: string): Promise<void> {
  await versioningRepository({ action: "delete", repo, path, expected });
}

export async function loadRepository(repo: string) {
  const status = await versioningRepository<RepositoryStatus>({ action: "status", repo });
  const text = await readFile(status.repo, PROJECT_PATH);
  const project = text ? parseProject(text) : null;
  return { status, project, projectText: text };
}

export async function loadReleases(
  repo: string,
  project: VersioningProject,
  commit?: string,
): Promise<DatabaseRelease[]> {
  const files = commit
    ? await versioningRepository<string[]>({ action: "files", repo, revision: commit })
    : (await versioningRepository<RepositoryStatus>({ action: "status", repo })).files;
  const releases: DatabaseRelease[] = [];
  for (const path of files.filter((file) => /^database\/releases\/[^/]+\.json$/.test(file))) {
    const text = await readFile(repo, path, commit);
    if (text === null) throw new Error(`Release-Datei ${path} fehlt.`);
    const release = await parseRelease(text, project);
    if (releasePath(release.id) !== path)
      throw new Error("Release-ID und Dateiname unterscheiden sich.");
    releases.push(release);
  }
  validateReleaseGraph(releases);
  return releases.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function resolveRelease(
  repo: string,
  project: VersioningProject,
  ref: ReleaseReference,
) {
  if (releasePath(ref.id) !== ref.path || !/^[a-f0-9]{40,64}$/.test(ref.commit))
    throw new Error("Ungültige Release-Referenz.");
  const text = await readFile(repo, ref.path, ref.commit);
  if (!text) throw new Error("Der gespeicherte Release ist nicht mehr im Repository verfügbar.");
  const release = await parseRelease(text, project);
  if (release.id !== ref.id)
    throw new Error("Gespeicherte Release-ID stimmt nicht mit dem Manifest überein.");
  return release;
}

export async function committedRelease(repo: string, project: VersioningProject, id: string) {
  const status = await versioningRepository<RepositoryStatus>({ action: "status", repo });
  if (!status.head) throw new Error("Bitte zuerst einen Commit erstellen.");
  const path = releasePath(id);
  const current = await readFile(repo, path);
  const committed = await readFile(repo, path, status.head);
  if (!current || !committed || current !== committed)
    throw new Error("Release enthält nicht commitete Änderungen. Bitte zuerst committen.");
  const release = await parseRelease(committed, project);
  if (release.id !== id) throw new Error("Release-ID stimmt nicht mit dem Manifest überein.");
  return { release, reference: { id, commit: status.head, path } };
}

export async function committedTeamConfiguration(
  repo: string,
  projectId: string,
): Promise<string | null> {
  const current = await readFile(repo, TEAM_PATH);
  const files = await versioningRepository<string[]>({ action: "files", repo, revision: "HEAD" });
  const committed = files.includes(TEAM_PATH) ? await readFile(repo, TEAM_PATH, "HEAD") : null;
  if (current !== committed)
    throw new Error(
      "Teamkonfiguration enthält offene Git-Änderungen. Vor dem Rollout prüfen und committen.",
    );
  if (current) parseTeamConfiguration(current, projectId);
  return current;
}

export async function readTargets(
  repo: string,
  projectId: string,
): Promise<{ store: TargetStore; text: string | null }> {
  const [local, team] = await Promise.all([
    versioningRepository<string | null>({ action: "local-read", repo }),
    readFile(repo, TEAM_PATH),
  ]);
  const store: TargetStore = local ? JSON.parse(local) : { format: 1, projectId, targets: [] };
  if (
    store.format !== 1 ||
    store.projectId !== projectId ||
    !Array.isArray(store.targets) ||
    new Set(store.targets.map((t) => t.id)).size !== store.targets.length ||
    store.targets.some(
      (t) =>
        !t.id ||
        !t.name ||
        typeof t.connectionId !== "string" ||
        (!t.connectionId && !t.connectionRef) ||
        (t.customer !== undefined && (typeof t.customer !== "string" || !t.customer.trim())) ||
        (t.environment !== undefined &&
          (typeof t.environment !== "string" || !t.environment.trim())) ||
        !Array.isArray(t.history) ||
        (t.track !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(t.track)) ||
        (t.paused !== undefined && typeof t.paused !== "boolean") ||
        (t.production !== true && t.production !== false) ||
        (t.binding &&
          (!/^[a-f0-9]{64}$/.test(t.binding.fingerprint) || typeof t.binding.label !== "string")),
    )
  )
    throw new Error(
      "Lokale Kundenzuordnungen sind ungültig oder gehören zu einem anderen Projekt.",
    );
  return {
    store: team ? mergeTeamTargets(store, parseTeamConfiguration(team, projectId)) : store,
    text: encode({ local, team }),
  };
}

export async function saveTargets(
  repo: string,
  store: TargetStore,
  expected: string | null,
): Promise<string> {
  const team = encode(createTeamConfiguration(store, useConnectionsStore.getState().connections));
  const { teamConfigured: _, ...localStore } = store;
  const previous = expected ? (JSON.parse(expected) as { local: string | null }) : null;
  const archived: TargetStore | null = previous?.local ? JSON.parse(previous.local) : null;
  localStore.targets = [
    ...localStore.targets,
    ...(archived?.targets.filter(
      (target) => !store.targets.some((entry) => entry.id === target.id),
    ) ?? []),
  ];
  localStore.connectionBindings = { ...archived?.connectionBindings, ...store.connectionBindings };
  const local = encode(localStore);
  const content = encode({ local, team });
  await versioningRepository({ action: "targets-write", repo, content, expected });
  return content;
}

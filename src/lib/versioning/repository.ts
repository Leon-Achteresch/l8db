import { versioningRepository } from "@/lib/db";
import { PROJECT_PATH, parseProject, parseRelease, releasePath } from "./model";
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
  const status = await versioningRepository<RepositoryStatus>({ action: "status", repo });
  const releases: DatabaseRelease[] = [];
  for (const path of status.files.filter((file) =>
    /^database\/releases\/[^/]+\.json$/.test(file),
  )) {
    const text = await readFile(repo, path, commit);
    if (text === null) throw new Error(`Release-Datei ${path} fehlt.`);
    const release = await parseRelease(text, project);
    if (releasePath(release.id) !== path)
      throw new Error("Release-ID und Dateiname unterscheiden sich.");
    releases.push(release);
  }
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
  return parseRelease(text, project);
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
  return { release, reference: { id, commit: status.head, path } };
}

export async function readTargets(
  repo: string,
  projectId: string,
): Promise<{ store: TargetStore; text: string | null }> {
  const text = await versioningRepository<string | null>({ action: "local-read", repo });
  const store: TargetStore = text ? JSON.parse(text) : { format: 1, projectId, targets: [] };
  if (
    store.format !== 1 ||
    store.projectId !== projectId ||
    !Array.isArray(store.targets) ||
    new Set(store.targets.map((t) => t.id)).size !== store.targets.length ||
    store.targets.some((t) => !t.id || !t.name || !t.connectionId || !Array.isArray(t.history))
  )
    throw new Error(
      "Lokale Kundenzuordnungen sind ungültig oder gehören zu einem anderen Projekt.",
    );
  return { store, text };
}

export async function saveTargets(
  repo: string,
  store: TargetStore,
  expected: string | null,
): Promise<string> {
  const content = encode(store);
  await versioningRepository({ action: "local-write", repo, content, expected });
  return content;
}

import { splitSqlStatements } from "@/lib/sql-statements";
import { validateSafety } from "./safety";
import { sqlCode } from "./sql-code";
import type { DatabaseRelease, ObjectDifference, ObjectSnapshot, VersioningProject } from "./types";

export const PROJECT_PATH = "database/project.json";
export const normalizeSource = (value: string) => value.replace(/\r\n?/g, "\n").trimEnd();

export async function checksum(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeSource(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function identifier(value: string): boolean {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value);
}

export function releasePath(id: string): string {
  if (!identifier(id))
    throw new Error(
      "Release-ID: Buchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich verwenden.",
    );
  return `database/releases/${id}.json`;
}

export function parseProject(text: string): VersioningProject {
  const project = JSON.parse(text) as VersioningProject;
  if (
    project.format !== 1 ||
    !identifier(project.id) ||
    !project.name?.trim() ||
    !["postgres", "oracle"].includes(project.kind) ||
    !Array.isArray(project.objects)
  )
    throw new Error("Ungültiges Versionierungsprojekt.");
  const ids = new Set<string>();
  const paths = new Set<string>();
  const identities = new Set<string>();
  for (const object of project.objects) {
    const identity = JSON.stringify([
      object.selection?.schema,
      object.selection?.objectType,
      object.selection?.objectName,
    ]);
    if (
      !identifier(object.id) ||
      ids.has(object.id) ||
      paths.has(object.path) ||
      identities.has(identity) ||
      (object.metadataVersion !== undefined && object.metadataVersion !== 2) ||
      !/^database\/objects\/[a-zA-Z0-9._-]+\.(sql|pks|pkb)$/.test(object.path) ||
      !object.selection?.schema ||
      !object.selection.objectName ||
      object.selection.objectName.toUpperCase() === "L8DB_VERSIONING_STATE" ||
      ![
        "table",
        "view",
        "routine",
        "procedure",
        "package",
        "sequence",
        "materialized_view",
      ].includes(object.selection.objectType)
    )
      throw new Error("Ungültige oder doppelte Objektzuordnung.");
    ids.add(object.id);
    identities.add(identity);
    paths.add(object.path);
    if (object.bodyPath) {
      if (
        object.selection.objectType !== "package" ||
        paths.has(object.bodyPath) ||
        !/^database\/objects\/[a-zA-Z0-9._-]+\.pkb$/.test(object.bodyPath)
      )
        throw new Error("Ungültiger Package-Body-Pfad.");
      paths.add(object.bodyPath);
    }
  }
  return project;
}

export async function parseRelease(
  text: string,
  project: VersioningProject,
): Promise<DatabaseRelease> {
  const release = JSON.parse(text) as DatabaseRelease;
  if (
    release.format !== 1 ||
    !identifier(release.id) ||
    release.projectId !== project.id ||
    release.kind !== project.kind ||
    (release.parent !== null && (!identifier(release.parent) || release.parent === release.id)) ||
    !Array.isArray(release.objects) ||
    !Array.isArray(release.migrations) ||
    (release.track !== undefined && !identifier(release.track)) ||
    typeof release.createdAt !== "string" ||
    !Number.isFinite(Date.parse(release.createdAt))
  )
    throw new Error("Release passt nicht zum Projekt oder ist ungültig.");
  if (release.safety !== undefined) await validateSafety(release.safety, project.kind);
  parseProject(
    JSON.stringify({ ...project, objects: release.objects.map((entry) => entry.object) }),
  );
  const ids = new Set<string>();
  for (const migration of release.migrations) {
    if (
      !identifier(migration.id) ||
      ids.has(migration.id) ||
      !migration.title?.trim() ||
      typeof migration.sql !== "string" ||
      !migration.sql.trim() ||
      (await checksum(migration.sql)) !== migration.checksum
    )
      throw new Error("Migration fehlt, ist doppelt oder ihre Prüfsumme stimmt nicht.");
    validateMigration(migration.sql, release.kind);
    ids.add(migration.id);
  }
  for (const snapshot of release.objects) {
    if (
      typeof snapshot.definition !== "string" ||
      !snapshot.definition.trim() ||
      (await checksum(snapshot.definition)) !== snapshot.checksum
    )
      throw new Error("Objekt-Prüfsumme stimmt nicht.");
  }
  return release;
}

export function validateMigration(sql: string, kind: "postgres" | "oracle"): string[] {
  if (/^(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)/m.test(sql))
    throw new Error("Migration enthält ungelöste Merge-Konflikte.");
  const split = splitSqlStatements(sql, kind);
  if (split.unterminated || split.statements.length === 0)
    throw new Error("SQL ist unvollständig oder leer.");
  const statements = split.statements.map((entry) => entry.text);
  for (const statement of statements) {
    const plain = sqlCode(statement);
    if (
      /^(?:COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT|START\s+TRANSACTION|BEGIN(?=\s*(?:;|TRANSACTION|WORK|$))|END(?=\s|;|$)|PREPARE\s+TRANSACTION|SET|RESET|DISCARD|ALTER\s+(?:SESSION|SYSTEM|ROLE|USER))\b/i.test(
        plain,
      )
    )
      throw new Error(
        "Transaktions- und Sitzungssteuerung sind in verwalteten Migrationen nicht zulässig.",
      );
    if (/\bL8DB_GENERATED_[A-F0-9]+\b/i.test(plain))
      throw new Error(
        "Generierte Oracle-Namen sind Vergleichsplatzhalter. Migration mit echten Constraintnamen oder einer geprüften Dictionary-Auflösung schreiben.",
      );
    if (/\b(?:L8DB_VERSIONING_STATE|SET_CONFIG)\b/i.test(plain))
      throw new Error("Migrationen dürfen Deployment-Historie und Sitzungsschutz nicht verändern.");
    if (
      kind === "oracle" &&
      /^(?:BEGIN|DECLARE)\b/i.test(plain) &&
      /\b(?:COMMIT|ROLLBACK|AUTONOMOUS_TRANSACTION)\b/i.test(plain)
    )
      throw new Error("Ausgeführte PL/SQL-Blöcke dürfen die verwaltete Transaktion nicht steuern.");
    if (
      kind === "postgres" &&
      /^(?:VACUUM|CREATE\s+(?:DATABASE|TABLESPACE)|DROP\s+(?:DATABASE|TABLESPACE)|(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|REINDEX\b[\s\S]*\bCONCURRENTLY)/i.test(
        plain,
      )
    )
      throw new Error(
        "Diese Anweisung benötigt ein separates Deployment außerhalb der verwalteten Transaktion.",
      );
  }
  return statements;
}

export const releaseTrack = (release: Pick<DatabaseRelease, "track">) => release.track ?? "main";

export function validateReleaseGraph(releases: DatabaseRelease[]) {
  const map = new Map(releases.map((release) => [release.id, release]));
  if (map.size !== releases.length) throw new Error("Doppelte Release-ID.");
  for (const release of releases) {
    const visited = new Set<string>();
    const migrations = new Set<string>();
    let current: DatabaseRelease | undefined = release;
    while (current) {
      if (visited.has(current.id)) throw new Error("Zyklische Release-Abhängigkeit.");
      visited.add(current.id);
      for (const migration of current.migrations) {
        if (migrations.has(migration.id))
          throw new Error(
            `Migrations-ID ${migration.id} wurde in dieser Vorgängerkette bereits verwendet.`,
          );
        migrations.add(migration.id);
      }
      if (!current.parent) break;
      const parent = map.get(current.parent);
      if (!parent) throw new Error(`Release ${current.parent} fehlt. Passenden Git-Branch laden.`);
      if (releaseTrack(parent) !== "main" && releaseTrack(parent) !== releaseTrack(current))
        throw new Error("Eine Kundenvariante darf nicht in eine fremde Release-Linie wechseln.");
      current = parent;
    }
  }
}

export function compareSnapshots(
  expected: ObjectSnapshot[],
  actual: ObjectSnapshot[],
): ObjectDifference[] {
  const left = new Map(expected.map((item) => [item.object.id, item]));
  const right = new Map(actual.map((item) => [item.object.id, item]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().map((id) => {
    const before = left.get(id);
    const after = right.get(id);
    return {
      id,
      label: (before ?? after)?.object.selection.objectName ?? id,
      expected: before?.definition ?? null,
      actual: after?.definition ?? null,
      status: !before
        ? "unmanaged"
        : !after
          ? "missing"
          : before.checksum === after.checksum
            ? "unchanged"
            : "changed",
    };
  });
}

export function releaseChain(
  releases: DatabaseRelease[],
  from: string,
  to: string,
): DatabaseRelease[] {
  const map = new Map(releases.map((release) => [release.id, release]));
  if (map.size !== releases.length) throw new Error("Doppelte Release-ID.");
  const chain: DatabaseRelease[] = [];
  const visited = new Set<string>();
  let id: string | null = to;
  while (id !== from) {
    if (id === null)
      throw new Error(
        "Das Ziel ist kein Nachfolger des Kundenstands. Downgrades benötigen einen eigenen geprüften Release.",
      );
    if (visited.has(id)) throw new Error("Zyklische Release-Abhängigkeit.");
    visited.add(id);
    const release = map.get(id);
    if (!release) throw new Error(`Release ${id} fehlt. Passenden Git-Branch laden.`);
    chain.unshift(release);
    id = release.parent;
  }
  const migrations = chain.flatMap((release) =>
    release.migrations.map((migration) => migration.id),
  );
  if (new Set(migrations).size !== migrations.length)
    throw new Error("Migrations-IDs müssen über den gesamten Updatepfad eindeutig sein.");
  return chain;
}

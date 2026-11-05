import { splitSqlStatements } from "@/lib/sql-statements";
import { validateSafety } from "./safety";
import { sqlCode } from "./sql-code";
import type {
  ChangeRules,
  DatabaseRelease,
  DeployKind,
  ObjectDifference,
  ObjectSnapshot,
  VersioningKind,
  VersioningProject,
} from "./types";

export const PROJECT_PATH = "database/project.json";
export const VERSIONING_KINDS: VersioningKind[] = [
  "postgres",
  "oracle",
  "mysql",
  "mssql",
  "sqlite",
  "duckdb",
  "clickhouse",
];
export const isVersioningKind = (kind: string | undefined): kind is VersioningKind =>
  VERSIONING_KINDS.includes(kind as VersioningKind);
export const deployable = (kind: string | undefined): kind is DeployKind =>
  kind === "postgres" || kind === "oracle";
export function deployKind(kind: VersioningKind): DeployKind {
  if (!deployable(kind))
    throw new Error("Releases und Deployments sind für PostgreSQL und Oracle verfügbar.");
  return kind;
}
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
    !isVersioningKind(project.kind) ||
    !Array.isArray(project.objects) ||
    (project.additiveOnly !== undefined && typeof project.additiveOnly !== "boolean")
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
      (object.metadataVersion !== undefined && ![2, 3].includes(object.metadataVersion)) ||
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

export const releaseParents = (release: Pick<DatabaseRelease, "format" | "parent" | "parents">) =>
  release.format === 2 ? (release.parents ?? []) : release.parent ? [release.parent] : [];

export async function validateCheckList(checks: unknown, kind: DeployKind) {
  if (checks === undefined) return;
  if (!Array.isArray(checks)) throw new Error("Prüfungen müssen eine Liste sein.");
  await validateSafety(
    {
      phase: "custom",
      compatibility: "online",
      notes: "",
      lockTimeoutMs: 5000,
      statementTimeoutMs: 60000,
      preconditions: checks,
      postconditions: [],
    },
    kind,
  );
}

export async function validateChangeRules(
  rules: ChangeRules,
  kind: DeployKind,
  objects: Set<string>,
  required: boolean,
) {
  const ids = (value: unknown) =>
    Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
  if (
    (rules.kind !== undefined && rules.kind !== "versioned" && rules.kind !== "repeatable") ||
    (required && rules.touches === undefined) ||
    (rules.touches !== undefined &&
      (!ids(rules.touches) ||
        new Set(rules.touches).size !== rules.touches.length ||
        rules.touches.some((id) => !objects.has(id)))) ||
    (rules.requires !== undefined && !ids(rules.requires)) ||
    (rules.data !== undefined && typeof rules.data !== "boolean") ||
    (rules.destructive !== undefined && typeof rules.destructive !== "boolean") ||
    (rules.before !== undefined &&
      (typeof rules.before !== "object" ||
        rules.before === null ||
        Object.entries(rules.before).some(
          ([id, hash]) =>
            !rules.touches?.includes(id) ||
            (hash !== null && (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))),
        ))) ||
    (rules.kind === "repeatable" && rules.touches?.length !== 1)
  )
    throw new Error("Änderungsregeln sind ungültig: touches, before, requires oder kind prüfen.");
  await validateCheckList(rules.preconditions, kind);
  await validateCheckList(rules.postconditions, kind);
  const unchecked = (rules.touches ?? []).filter((id) => !(id in (rules.before ?? {})));
  if (unchecked.length && !rules.preconditions?.length && rules.kind !== "repeatable")
    throw new Error(
      `Für ${unchecked.join(", ")} fehlt ein erwarteter Vorher-Stand. Vorbedingung ergänzen.`,
    );
}

export async function parseRelease(
  text: string,
  project: VersioningProject,
): Promise<DatabaseRelease> {
  const release = JSON.parse(text) as DatabaseRelease;
  const parents = release.format === 2 ? release.parents : undefined;
  if (
    (release.format !== 1 && release.format !== 2) ||
    !identifier(release.id) ||
    release.projectId !== project.id ||
    release.kind !== project.kind ||
    !deployable(release.kind) ||
    (release.format === 1 &&
      (release.parent === undefined ||
        (release.parent !== null &&
          (!identifier(release.parent) || release.parent === release.id)))) ||
    (release.format === 2 &&
      (release.parent !== undefined ||
        !Array.isArray(parents) ||
        parents.length > 16 ||
        new Set(parents).size !== parents.length ||
        parents.some((id) => !identifier(id) || id === release.id) ||
        (release.changes !== undefined &&
          (!Array.isArray(release.changes) ||
            new Set(release.changes).size !== release.changes.length ||
            release.changes.some((id) => !identifier(id)))))) ||
    (release.format === 1 && release.changes !== undefined) ||
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
  const objectIds = new Set([
    ...release.objects.map((entry) => entry.object.id),
    ...project.objects.map((entry) => entry.id),
  ]);
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
    if (release.format === 1 && Object.keys(migration).some((key) => !LEGACY_KEYS.has(key)))
      throw new Error("Änderungsregeln benötigen Release-Format 2.");
    if (release.format === 2)
      await validateChangeRules(
        migration,
        release.kind,
        objectIds,
        (release.parents?.length ?? 0) > 1,
      );
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

const LEGACY_KEYS = new Set(["id", "title", "sql", "checksum"]);

export function destructiveStatement(sql: string): boolean {
  const tokens = sql.toUpperCase().split(/[^A-Z0-9_$#]+/);
  return tokens.some(
    (token, index) =>
      ["DROP", "TRUNCATE", "MODIFY"].includes(token) ||
      (token === "ALTER" &&
        tokens[index + 1] === "COLUMN" &&
        (tokens[index + 3] === "TYPE" ||
          (tokens[index + 3] === "SET" &&
            tokens[index + 4] === "DATA" &&
            tokens[index + 5] === "TYPE"))),
  );
}

export function validateMigration(sql: string, kind: DeployKind): string[] {
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

export function releaseAncestry(
  map: Map<string, DatabaseRelease>,
  id: string,
  strict = true,
): DatabaseRelease[] {
  const order: DatabaseRelease[] = [];
  const done = new Set<string>();
  const active = new Set<string>();
  const stack: { id: string; next: number }[] = [{ id, next: 0 }];
  active.add(id);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const release = map.get(frame.id);
    if (!release) {
      if (strict) throw new Error(`Release ${frame.id} fehlt. Passenden Git-Branch laden.`);
      stack.pop();
      active.delete(frame.id);
      done.add(frame.id);
      continue;
    }
    const parents = releaseParents(release);
    if (frame.next < parents.length) {
      const parent = parents[frame.next++];
      if (active.has(parent)) throw new Error("Zyklische Release-Abhängigkeit.");
      if (done.has(parent)) continue;
      active.add(parent);
      stack.push({ id: parent, next: 0 });
      continue;
    }
    stack.pop();
    active.delete(frame.id);
    done.add(frame.id);
    order.push(release);
  }
  return order;
}

export function validateReleaseGraph(releases: DatabaseRelease[]) {
  const map = new Map(releases.map((release) => [release.id, release]));
  if (map.size !== releases.length) throw new Error("Doppelte Release-ID.");
  for (const release of releases) {
    for (const id of releaseParents(release)) {
      const parent = map.get(id);
      if (!parent) throw new Error(`Release ${id} fehlt. Passenden Git-Branch laden.`);
      if (releaseTrack(parent) !== "main" && releaseTrack(parent) !== releaseTrack(release))
        throw new Error("Eine Kundenvariante darf nicht in eine fremde Release-Linie wechseln.");
    }
  }
  const done = new Set<string>();
  for (const release of releases) {
    if (done.has(release.id)) continue;
    for (const entry of releaseAncestry(map, release.id)) done.add(entry.id);
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

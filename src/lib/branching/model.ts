import type {
  BranchingDatabase,
  BranchingJob,
  BranchMeta,
  ProtectionLevel,
  SchemaSource,
  SnapshotInfo,
} from "@/lib/db";

export interface TreeRow {
  database: BranchingDatabase;
  branch: BranchMeta | null;
  depth: number;
  last: boolean;
  guides: boolean[];
}

export const KIND_LABELS: Record<string, string> = {
  full: "Vollkopie",
  schema: "Nur Schema",
  anonymized: "Anonymisiert",
  previous: "Vorheriger Stand",
  staging: "Zwischenstufe",
};

export const METHOD_LABELS: Record<string, string> = {
  clone: "Sofort-Klon",
  stream: "Datenstrom",
  snapshot: "Aus Sicherung",
  restore: "Wiederherstellung",
  reset: "Zurückgesetzt",
};

export const PROTECTION_LABELS: Record<ProtectionLevel, string> = {
  protected: "Geschützt",
  masked: "Maskiert",
};

export function branchOf(database: BranchingDatabase): BranchMeta | null {
  return database.marker?.branch ?? null;
}

export function isDisposable(database: BranchingDatabase): boolean {
  const kind = branchOf(database)?.kind;
  return kind === "previous" || kind === "staging";
}

export function isProtected(database: BranchingDatabase): boolean {
  return Boolean(database.marker?.protection || database.marker?.branch?.protected);
}

export function isMasked(database: BranchingDatabase | undefined): boolean {
  return database?.marker?.protection === "masked";
}

export function isWorking(database: BranchingDatabase): boolean {
  return branchOf(database)?.status === "creating";
}

export function branchTree(databases: BranchingDatabase[], root: string): TreeRow[] {
  const byParent = new Map<string, BranchingDatabase[]>();
  for (const database of databases) {
    const parent = branchOf(database)?.parent;
    if (!parent || database.name === root) continue;
    byParent.set(parent, [...(byParent.get(parent) ?? []), database]);
  }
  const order = (database: BranchingDatabase) => {
    const branch = branchOf(database);
    return `${isDisposable(database) ? 1 : 0}:${branch?.createdAt ?? ""}:${database.name}`;
  };
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (database: BranchingDatabase, depth: number, last: boolean, guides: boolean[]) => {
    if (seen.has(database.name)) return;
    seen.add(database.name);
    rows.push({ database, branch: branchOf(database), depth, last, guides });
    const children = [...(byParent.get(database.name) ?? [])].sort((a, b) =>
      order(a).localeCompare(order(b)),
    );
    children.forEach((child, index) => {
      walk(child, depth + 1, index === children.length - 1, [...guides, !last]);
    });
  };
  const top = databases.find((database) => database.name === root);
  if (top) walk(top, 0, true, []);
  return rows;
}

export function sourceChoices(databases: BranchingDatabase[]): BranchingDatabase[] {
  return databases.filter((database) => !isDisposable(database) && !isWorking(database));
}

export function validBranchName(name: string): string | null {
  if (!name) return "Name eingeben.";
  if (name.length > 63) return "Höchstens 63 Zeichen.";
  if (!/^[a-z][a-z0-9_-]*$/.test(name))
    return "Kleinbuchstaben, Ziffern, „_“ oder „-“, beginnend mit einem Buchstaben.";
  return null;
}

export function suggestBranchName(root: string, taken: string[], base = "dev"): string {
  const stem = root
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);
  const prefix = stem ? `${stem}_` : "branch_";
  for (let index = 1; index < 1000; index += 1) {
    const name = `${prefix}${base}${index === 1 ? "" : index}`;
    if (!taken.includes(name)) return name;
  }
  return `${prefix}${base}_${Date.now()}`;
}

export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const minutes = Math.round((time - now) / 60_000);
  const abs = Math.abs(minutes);
  const format = (amount: number, unit: Intl.RelativeTimeFormatUnit) =>
    new Intl.RelativeTimeFormat("de", { numeric: "auto" }).format(amount, unit);
  if (abs < 1) return "gerade eben";
  if (abs < 60) return format(minutes, "minute");
  if (abs < 60 * 36) return format(Math.round(minutes / 60), "hour");
  return format(Math.round(minutes / (60 * 24)), "day");
}

export function expiryText(value: string | null | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return time <= now ? "abgelaufen" : `läuft ${relativeTime(value, now)} ab`;
}

export function isExpired(value: string | null | undefined, now = Date.now()): boolean {
  const time = value ? Date.parse(value) : Number.NaN;
  return !Number.isNaN(time) && time <= now;
}

export function hoursFromNow(hours: number, now = Date.now()): string {
  return new Date(now + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function branchUrl(connectionString: string, database: string): string | null {
  try {
    const url = new URL(connectionString);
    if (!url.host) return null;
    url.password = "";
    url.pathname = `/${encodeURIComponent(database)}`;
    return url.toString();
  } catch {
    return null;
  }
}

export function serverJobs(jobs: BranchingJob[], identity: string | undefined): BranchingJob[] {
  if (!identity) return [];
  return jobs.filter((job) => job.database.startsWith(`${identity}/`));
}

export function snapshotsFor(snapshots: SnapshotInfo[], database: string): SnapshotInfo[] {
  return snapshots.filter((snapshot) => !snapshot.problem && snapshot.database === database);
}

export function jobProgress(job: Pick<BranchingJob, "done" | "total">): number | null {
  if (job.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((job.done / job.total) * 100)));
}

export interface CompareChoice {
  key: string;
  label: string;
  source: SchemaSource;
}

export function compareChoices(
  databases: BranchingDatabase[],
  snapshots: SnapshotInfo[],
): CompareChoice[] {
  const live = databases
    .filter((database) => !isWorking(database) && branchOf(database)?.kind !== "staging")
    .map((database) => ({
      key: `live:${database.name}`,
      label: `${database.name} · aktueller Stand`,
      source: { kind: "live", database: database.name } as SchemaSource,
    }));
  const saved = snapshots
    .filter((snapshot) => !snapshot.problem)
    .map((snapshot) => ({
      key: `snapshot:${snapshot.id}`,
      label: `${snapshot.database} · ${snapshot.label} · ${new Date(snapshot.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`,
      source: { kind: "snapshot", id: snapshot.id } as SchemaSource,
    }));
  return [...live, ...saved];
}

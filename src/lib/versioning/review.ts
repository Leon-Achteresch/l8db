import { type DiffHunk, diffLines, splitLines } from "@/lib/ai/editor/line-diff";
import { PROJECT_PATH } from "./model";
import { SEED_PATH } from "./seeds";
import { TEAM_PATH } from "./team";
import type { ManagedObject, VersioningProject } from "./types";

export type ObjectCategory =
  | "table"
  | "view"
  | "materialized_view"
  | "routine"
  | "procedure"
  | "package"
  | "sequence"
  | "release"
  | "customers"
  | "tickets"
  | "seeds"
  | "project"
  | "other";

export const CATEGORY_ORDER: ObjectCategory[] = [
  "table",
  "view",
  "materialized_view",
  "routine",
  "procedure",
  "package",
  "sequence",
  "release",
  "customers",
  "seeds",
  "tickets",
  "project",
  "other",
];

export const CATEGORY_LABELS: Record<ObjectCategory, [string, string]> = {
  table: ["Tabelle", "Tabellen"],
  view: ["View", "Views"],
  materialized_view: ["Materialisierte View", "Materialisierte Views"],
  routine: ["Funktion", "Funktionen"],
  procedure: ["Prozedur", "Prozeduren"],
  package: ["Package", "Packages"],
  sequence: ["Sequenz", "Sequenzen"],
  release: ["Release", "Releases"],
  customers: ["Kunden & Umgebungen", "Kunden & Umgebungen"],
  seeds: ["Seed-Daten", "Seed-Daten"],
  tickets: ["Ticket-Verknüpfung", "Ticket-Verknüpfung"],
  project: ["Projekt", "Projekt"],
  other: ["Datei", "Dateien"],
};

export const TICKETS_PATH = "database/tickets.json";

export interface ChangedObject {
  path: string;
  status: string;
  category: ObjectCategory;
  name: string;
  schema: string | null;
  object: ManagedObject | null;
}

export function objectIndex(project: VersioningProject | null) {
  const index = new Map<string, ManagedObject>();
  for (const object of project?.objects ?? []) {
    index.set(object.path, object);
    if (object.bodyPath) index.set(object.bodyPath, object);
  }
  return index;
}

export function describePath(
  path: string,
  status: string,
  index: Map<string, ManagedObject>,
): ChangedObject {
  const object = index.get(path) ?? null;
  if (object) {
    const body = object.bodyPath === path;
    return {
      path,
      status,
      category: object.selection.objectType as ObjectCategory,
      name: `${object.selection.objectName ?? path}${body ? " (Body)" : ""}`,
      schema: object.selection.schema ?? null,
      object,
    };
  }
  const release = /^database\/releases\/([^/]+)\.json$/.exec(path);
  if (release)
    return { path, status, category: "release", name: release[1], schema: null, object: null };
  const known: Record<string, [ObjectCategory, string]> = {
    [TEAM_PATH]: ["customers", "Kunden, Umgebungen und Regeln"],
    [SEED_PATH]: ["seeds", "Seed-Daten"],
    [TICKETS_PATH]: ["tickets", "Ticket-Systeme"],
    [PROJECT_PATH]: ["project", "Verwaltete Objekte"],
  };
  if (known[path])
    return {
      path,
      status,
      category: known[path][0],
      name: known[path][1],
      schema: null,
      object: null,
    };
  const objectFile =
    /^database\/objects\/(.+?)-(table|view|materialized_view|routine|procedure|package|sequence)(?:-[a-f0-9]{8})?\.(?:sql|pks|pkb)$/.exec(
      path,
    );
  if (objectFile) {
    const [schema, ...rest] = objectFile[1].split("-");
    return {
      path,
      status,
      category: objectFile[2] as ObjectCategory,
      name: rest.join("-") || objectFile[1],
      schema: rest.length ? schema : null,
      object: null,
    };
  }
  return {
    path,
    status,
    category: "other",
    name: path.replace(/^database\//, ""),
    schema: null,
    object: null,
  };
}

export function groupChanges(
  files: { path: string; status: string }[],
  project: VersioningProject | null,
) {
  const index = objectIndex(project);
  const groups = new Map<ObjectCategory, ChangedObject[]>();
  for (const file of files) {
    const entry = describePath(file.path, file.status, index);
    const list = groups.get(entry.category);
    if (list) list.push(entry);
    else groups.set(entry.category, [entry]);
  }
  return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
    category,
    entries: (groups.get(category) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export function categoryCounts(project: VersioningProject | null) {
  const counts = new Map<ObjectCategory, number>();
  for (const object of project?.objects ?? []) {
    const category = object.selection.objectType as ObjectCategory;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
}

const SECTION_LABELS: Record<string, string> = {
  COLUMNS: "Spalten",
  CONSTRAINTS: "Constraints",
  INDEXES: "Indizes",
  TRIGGERS: "Trigger",
};

function tableSections(text: string) {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of splitLines(text)) {
    if (SECTION_LABELS[line.trim()] && !line.startsWith(" ")) {
      current = new Map();
      sections.set(line.trim(), current);
      continue;
    }
    if (!current || !line.startsWith("  ")) continue;
    const entry = line.trim();
    const name =
      /^(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?|CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+)?("[^"]+"|\S+)/i.exec(
        entry,
      )?.[1];
    if (name) current.set(name, entry);
  }
  return sections;
}

export interface StructureChange {
  section: string;
  added: string[];
  removed: string[];
  changed: string[];
}

export function tableChanges(before: string, after: string): StructureChange[] | null {
  if (!/^TABLE /.test(before || after)) return null;
  const old = tableSections(before);
  const next = tableSections(after);
  const result: StructureChange[] = [];
  for (const section of Object.keys(SECTION_LABELS)) {
    const a = old.get(section) ?? new Map<string, string>();
    const b = next.get(section) ?? new Map<string, string>();
    const change: StructureChange = {
      section: SECTION_LABELS[section],
      added: [...b.keys()].filter((name) => !a.has(name)),
      removed: [...a.keys()].filter((name) => !b.has(name)),
      changed: [...b.keys()].filter((name) => a.has(name) && a.get(name) !== b.get(name)),
    };
    if (change.added.length || change.removed.length || change.changed.length) result.push(change);
  }
  return result;
}

export type DiffRow =
  | { kind: "context" | "add" | "remove"; old: number | null; new: number | null; text: string }
  | { kind: "gap"; hidden: number; from: number };

const SMALL_DIFF = 4_000_000;

function anchors(left: string[], right: string[]) {
  const count = (lines: string[]) => {
    const seen = new Map<string, number>();
    lines.forEach((line, index) => {
      seen.set(line, seen.has(line) ? -1 : index);
    });
    return seen;
  };
  const a = count(left);
  const b = count(right);
  const pairs: [number, number][] = [];
  for (const [line, index] of a)
    if (index >= 0) {
      const other = b.get(line);
      if (other !== undefined && other >= 0) pairs.push([index, other]);
    }
  pairs.sort((x, y) => x[0] - y[0]);
  const tails: number[] = [];
  const previous = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, value], index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (pairs[tails[middle]][1] < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const result: [number, number][] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index])
    result.push(pairs[index]);
  return result.reverse();
}

export function lineHunks(left: string[], right: string[]): DiffHunk[] {
  if (left.length * right.length <= SMALL_DIFF)
    return diffLines(left.join("\n"), right.join("\n"), { maxCells: SMALL_DIFF });
  const hunks: DiffHunk[] = [];
  let oldAt = 0;
  let newAt = 0;
  for (const [oldAnchor, newAnchor] of [...anchors(left, right), [left.length, right.length]]) {
    const oldPart = left.slice(oldAt, oldAnchor);
    const newPart = right.slice(newAt, newAnchor);
    if (!oldPart.length || !newPart.length) {
      if (oldPart.length || newPart.length)
        hunks.push({
          oldStart: oldAt + 1,
          oldLines: oldPart,
          newStart: newAt + 1,
          newLines: newPart,
        });
    } else
      for (const hunk of diffLines(oldPart.join("\n"), newPart.join("\n"), {
        maxCells: SMALL_DIFF,
      }))
        hunks.push({
          ...hunk,
          oldStart: hunk.oldStart + oldAt,
          newStart: hunk.newStart + newAt,
        });
    oldAt = oldAnchor + 1;
    newAt = newAnchor + 1;
  }
  return hunks;
}

export function reviewRows(before: string, after: string, context = 3): DiffRow[] {
  const left = before ? splitLines(before.replace(/\n$/, "")) : [];
  const right = after ? splitLines(after.replace(/\n$/, "")) : [];
  const hunks = lineHunks(left, right);
  const rows: DiffRow[] = [];
  if (!before && after)
    return right.map((text, index) => ({ kind: "add", old: null, new: index + 1, text }));
  if (before && !after)
    return left.map((text, index) => ({ kind: "remove", old: index + 1, new: null, text }));
  let oldLine = 1;
  let newLine = 1;
  const contextRows = (from: number, to: number, shift: number) => {
    for (let line = from; line < to; line++)
      rows.push({ kind: "context", old: line, new: line + shift, text: left[line - 1] ?? "" });
  };
  for (const hunk of hunks) {
    const shift = newLine - oldLine;
    const gapEnd = hunk.oldStart;
    if (gapEnd - oldLine > context * 2) {
      if (rows.length) contextRows(oldLine, oldLine + context, shift);
      const skipFrom = rows.length ? oldLine + context : oldLine;
      const hidden = gapEnd - context - skipFrom;
      if (hidden > 0) rows.push({ kind: "gap", hidden, from: skipFrom });
      contextRows(gapEnd - context, gapEnd, shift);
    } else contextRows(oldLine, gapEnd, shift);
    hunk.oldLines.forEach((text, index) => {
      rows.push({ kind: "remove", old: hunk.oldStart + index, new: null, text });
    });
    hunk.newLines.forEach((text, index) => {
      rows.push({ kind: "add", old: null, new: hunk.newStart + index, text });
    });
    oldLine = hunk.oldStart + hunk.oldLines.length;
    newLine = hunk.newStart + hunk.newLines.length;
  }
  const shift = newLine - oldLine;
  const tail = left.length + 1 - oldLine;
  if (tail > context) {
    contextRows(oldLine, oldLine + context, shift);
    rows.push({ kind: "gap", hidden: tail - context, from: oldLine + context });
  } else contextRows(oldLine, left.length + 1, shift);
  return rows;
}

export interface TicketTracker {
  id: string;
  label: string;
  pattern: string;
  url: string;
}

export interface TicketConfiguration {
  format: 1;
  trackers: TicketTracker[];
}

export const TRACKER_PRESETS: { label: string; pattern: string; url: string }[] = [
  {
    label: "Jira",
    pattern: "[A-Z][A-Z0-9_]+-\\d+",
    url: "https://firma.atlassian.net/browse/{key}",
  },
  {
    label: "YouTrack",
    pattern: "[A-Z][A-Z0-9_]+-\\d+",
    url: "https://firma.youtrack.cloud/issue/{key}",
  },
  { label: "Linear", pattern: "[A-Z][A-Z0-9]+-\\d+", url: "https://linear.app/firma/issue/{key}" },
  {
    label: "Azure Boards",
    pattern: "AB#(\\d+)",
    url: "https://dev.azure.com/firma/projekt/_workitems/edit/{id}",
  },
  {
    label: "GitHub Issues",
    pattern: "GH-(\\d+)",
    url: "https://github.com/firma/repository/issues/{id}",
  },
  { label: "Andere", pattern: "TICKET-\\d+", url: "https://tickets.example.com/{key}" },
];

export const DEFAULT_TICKETS: TicketConfiguration = {
  format: 1,
  trackers: [{ id: "default", label: "Ticket", pattern: "[A-Z][A-Z0-9_]+-\\d+", url: "" }],
};

const compiled = new Map<string, RegExp | null>();

function trackerPattern(pattern: string) {
  if (!compiled.has(pattern)) {
    try {
      compiled.set(pattern, new RegExp(`(?<![A-Za-z0-9_])(?:${pattern})(?![A-Za-z0-9_])`, "g"));
    } catch {
      compiled.set(pattern, null);
    }
  }
  return compiled.get(pattern) ?? null;
}

export function validateTickets(value: TicketConfiguration): TicketConfiguration {
  if (value?.format !== 1 || !Array.isArray(value.trackers) || value.trackers.length > 8)
    throw new Error("Ungültige Ticket-Konfiguration.");
  const ids = new Set<string>();
  for (const tracker of value.trackers) {
    if (
      !/^[a-z0-9-]{1,40}$/.test(tracker.id) ||
      ids.has(tracker.id) ||
      !tracker.label?.trim() ||
      tracker.label.length > 60 ||
      !tracker.pattern ||
      tracker.pattern.length > 200 ||
      !trackerPattern(tracker.pattern) ||
      tracker.url.length > 300 ||
      (tracker.url && !/^https:\/\/[^\s]+\{(?:key|id)\}/.test(tracker.url))
    )
      throw new Error(
        `Ticket-System „${tracker.label || tracker.id}“: Name, Muster oder Link-Vorlage prüfen. Links müssen mit https:// beginnen und {key} oder {id} enthalten.`,
      );
    ids.add(tracker.id);
  }
  return value;
}

export function parseTickets(text: string | null): TicketConfiguration {
  if (!text) return DEFAULT_TICKETS;
  return validateTickets(JSON.parse(text) as TicketConfiguration);
}

export interface TicketReference {
  key: string;
  tracker: string;
  url: string | null;
}

export function findTickets(
  texts: (string | null | undefined)[],
  configuration: TicketConfiguration,
): TicketReference[] {
  const found = new Map<string, TicketReference>();
  for (const raw of texts) {
    if (!raw) continue;
    const text = raw.slice(0, 20_000);
    for (const tracker of configuration.trackers) {
      const pattern = trackerPattern(tracker.pattern);
      if (!pattern) continue;
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const key = match[0];
        if (found.has(key) || found.size >= 50) continue;
        const id = match[1] ?? /\d+/.exec(key)?.[0] ?? key;
        found.set(key, {
          key,
          tracker: tracker.label,
          url: tracker.url
            ? tracker.url
                .replaceAll("{key}", encodeURIComponent(key))
                .replaceAll("{id}", encodeURIComponent(id))
            : null,
        });
      }
    }
  }
  return [...found.values()];
}

export function ticketPrefix(message: string, tickets: TicketReference[]) {
  const missing = tickets.filter((ticket) => !message.includes(ticket.key));
  if (!missing.length) return message;
  return `${missing.map((ticket) => ticket.key).join(" ")}: ${message}`;
}

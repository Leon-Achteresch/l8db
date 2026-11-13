import { STORAGE_BACKUP_PREFIX } from "@/lib/app-storage";

const LABELS: Record<string, string> = {
  "l8db.table-tabs": "Tabs",
  "l8db.query-history": "Abfrageverlauf",
  "l8db.tasks": "Aufgaben",
  "l8db.settings": "Einstellungen",
  "l8db.connections": "Verbindungen",
  "l8db.editor-view-state": "Editor-Positionen",
  "l8db.object-drafts": "Objekt-Entwürfe",
  "l8db.saved-queries": "Gespeicherte Abfragen",
  "l8db.saved-tabs": "Gespeicherte Tab-Sets",
  "l8db.snippets": "Snippets",
  "l8db.table-view-state": "Tabellenansichten",
  "l8db.table-column-prefs": "Spaltenbreiten",
  "l8db.result-charts": "Ergebnis-Diagramme",
  "l8db.db-selection": "Datenbankauswahl",
  "l8db.transactions": "Transaktionen",
  "l8db.notebook": "Notebooks",
  "l8db.hotkeys": "Tastenkürzel",
  "l8db.palette-history": "Befehlsverlauf",
  "l8db.sidebar-search-history": "Suchverlauf",
  "l8db.export-templates": "Exportvorlagen",
  "l8db.views": "Ansichten",
  "l8db.ai": "KI",
  "l8db.boot": "Startansicht",
  "l8db-dashboards": "Dashboards",
  "l8db.team": "Team-Verbindungen",
  "l8db.tour": "Rundgang",
  "l8db.blog-suggestions": "Blog-Hinweise",
  "l8db.feature-videos": "Funktionsvideos",
  "l8db.secret-edits": "Passwort-Änderungen",
  "l8db.schema-compare": "Schema-Vergleich",
  "l8db.home-layout": "Startseite",
  "l8db.split-view": "Geteilte Ansicht",
  "l8db.workbench": "Arbeitsbereich",
  "l8db.query-workspace": "Abfrage-Arbeitsbereich",
  "l8db.ui-plugins": "UI-Plugins",
  "l8db.sync": "Synchronisierung",
};

const PREFIX_LABELS: [string, string][] = [
  ["l8db.new-feature-seen", "Neu-Markierungen"],
  ["l8db.discovery.", "Entdecken"],
  ["l8db.island.", "Statusinsel"],
  ["l8db.usage-statistics.", "Nutzungsstatistik"],
  ["l8db.sync-", "Synchronisierung"],
];

export const PROTECTED_STORAGE_KEYS = new Set(["l8db.connections"]);
export const CONNECTION_REMOVABLE_KEYS = new Set([
  "l8db.table-tabs",
  "l8db.query-history",
  "l8db.db-selection",
  "l8db.object-drafts",
  "l8db.table-view-state",
  "l8db.tasks",
  "l8db-dashboards",
]);
const OWNER_FIELDS = ["connectionId", "closedConnectionId"];

export interface StorageArea {
  key: string;
  label: string;
  bytes: number;
}

export interface ConnectionShare {
  bytes: number;
  areas: Map<string, number>;
}

export function entryBytes(key: string, value: string) {
  return (key.length + value.length) * 2;
}

export function storageLabel(key: string): string {
  if (key.startsWith(STORAGE_BACKUP_PREFIX))
    return `Sicherung: ${storageLabel(key.slice(STORAGE_BACKUP_PREFIX.length))}`;
  return (
    LABELS[key] ??
    PREFIX_LABELS.find(([prefix]) => key.startsWith(prefix))?.[1] ??
    key.replace(/^l8db[.-]/, "")
  );
}

export function storageAreas(entries: Iterable<[string, string]>): StorageArea[] {
  return [...entries]
    .map(([key, value]) => ({ key, label: storageLabel(key), bytes: entryBytes(key, value) }))
    .sort((a, b) => b.bytes - a.bytes);
}

function ownerOfKey(prop: string, parent: string | undefined, known: Set<string>) {
  if (parent?.endsWith("ByConnection") || known.has(prop)) return prop;
  if (!prop.startsWith("[")) return undefined;
  try {
    const parsed = JSON.parse(prop) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && known.has(parsed[0]))
      return parsed[0];
  } catch {}
  return undefined;
}

function ownerOfValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const field of OWNER_FIELDS) {
    const owner = (value as Record<string, unknown>)[field];
    if (typeof owner === "string" && owner) return owner;
  }
  return undefined;
}

function walk(
  node: unknown,
  parent: string | undefined,
  known: Set<string>,
  found: (owner: string, value: unknown, keyLength: number) => void,
  remove?: string,
): unknown {
  if (Array.isArray(node)) {
    const items: unknown[] = [];
    for (const item of node) {
      const owner = ownerOfValue(item);
      if (owner === undefined) items.push(walk(item, undefined, known, found, remove));
      else {
        found(owner, item, 0);
        if (owner !== remove) items.push(item);
      }
    }
    return items;
  }
  if (!node || typeof node !== "object") return node;
  const result: Record<string, unknown> = {};
  for (const [prop, child] of Object.entries(node)) {
    const owner = ownerOfKey(prop, parent, known) ?? ownerOfValue(child);
    if (owner === undefined) result[prop] = walk(child, prop, known, found, remove);
    else {
      found(owner, child, prop.length);
      if (owner !== remove) result[prop] = child;
    }
  }
  return result;
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function connectionShares(
  entries: Iterable<[string, string]>,
  connectionIds: Iterable<string>,
): Map<string, ConnectionShare> {
  const known = new Set(connectionIds);
  const shares = new Map<string, ConnectionShare>();
  for (const [key, value] of entries) {
    if (PROTECTED_STORAGE_KEYS.has(key)) continue;
    const parsed = parse(value);
    if (!parsed || typeof parsed !== "object") continue;
    walk(parsed, undefined, known, (owner, child, keyLength) => {
      const bytes = (keyLength + JSON.stringify(child).length) * 2;
      const share = shares.get(owner) ?? { bytes: 0, areas: new Map() };
      share.bytes += bytes;
      share.areas.set(key, (share.areas.get(key) ?? 0) + bytes);
      shares.set(owner, share);
    });
  }
  return shares;
}

export function withoutConnection(
  key: string,
  value: string,
  connectionId: string,
  connectionIds: Iterable<string>,
): string | null {
  const parsed = parse(value);
  if (!CONNECTION_REMOVABLE_KEYS.has(key)) return null;
  if (!parsed || typeof parsed !== "object") return null;
  let removed = false;
  const known = new Set([...connectionIds, connectionId]);
  const next = walk(
    parsed,
    undefined,
    known,
    (owner) => {
      if (owner === connectionId) removed = true;
    },
    connectionId,
  );
  return removed ? JSON.stringify(next) : null;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

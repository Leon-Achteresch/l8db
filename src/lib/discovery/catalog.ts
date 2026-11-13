import { commandNeedle, scoreNeedle } from "@/lib/command-score";
import type { Capabilities } from "@/lib/db";
import { CATALOG_ENTRIES } from "./catalog-entries";
import {
  FEATURE_AREAS,
  type FeatureArea,
  type FeatureEntry,
  type FeatureSearchOptions,
} from "./types";

export type { FeatureArea, FeatureEntry, FeatureSearchOptions, GuideStep } from "./types";
export { FEATURE_AREAS };

export const FEATURE_CATALOG: readonly FeatureEntry[] = CATALOG_ENTRIES;

export const DEFAULT_SEARCH_LIMIT = 8;
const MIN_TOKEN_SCORE = 90;

const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["vergleichen", "vergleich", "compare", "diff", "unterschied", "abgleich", "abweichung"],
  ["exportieren", "export", "csv", "excel", "xlsx", "download", "herunterladen"],
  ["importieren", "import", "einlesen", "hochladen", "upload"],
  ["filtern", "filter", "where", "eingrenzen", "bedingung"],
  ["suchen", "suche", "finden", "search", "find"],
  ["ki", "ai", "assistent", "chat", "llm", "gpt", "claude", "copilot"],
  ["tastenkuerzel", "tastenkürzel", "shortcut", "hotkey", "tastatur", "keyboard"],
  ["diagramm", "erd", "beziehungen", "relations", "fremdschluessel", "foreign"],
  ["explain", "ausfuehrungsplan", "ausführungsplan", "plan", "langsam", "performance", "index"],
  ["verbindung", "connection", "verbinden", "login", "anmelden"],
  ["tunnel", "ssh", "bastion", "jumphost", "proxy"],
  ["automatisierung", "automation", "zeitplan", "schedule", "cron", "aufgabe", "task", "job"],
  ["dashboard", "bericht", "report", "chart", "visualisierung", "grafik", "diagramme"],
  ["versionierung", "versioning", "migration", "release", "deployment", "git"],
  ["formatieren", "format", "beautify", "einruecken", "einrücken", "huebsch"],
  ["verlauf", "history", "historie", "zuletzt", "frueher"],
  ["uebertragen", "übertragen", "transfer", "kopieren", "copy", "migrieren"],
  ["sicherung", "backup", "dump", "wiederherstellen", "restore"],
  ["ueberwachen", "überwachen", "monitor", "live", "sitzungen", "sessions", "aktivitaet"],
  ["teilen", "split", "nebeneinander", "geteilt"],
  ["erstellen", "anlegen", "create", "neu", "new"],
  ["aendern", "ändern", "bearbeiten", "edit", "alter"],
  ["einstellungen", "settings", "optionen", "konfiguration", "preferences"],
  ["fenster", "window", "mehrere"],
  ["team", "kollegen", "gemeinsam", "geteilt"],
  ["erweiterung", "extension", "plugin", "addon"],
];

const STOPWORDS = new Set(
  [
    "wie",
    "ich",
    "kann",
    "man",
    "zwei",
    "mit",
    "ein",
    "eine",
    "einen",
    "einem",
    "der",
    "die",
    "das",
    "den",
    "dem",
    "des",
    "und",
    "oder",
    "in",
    "im",
    "auf",
    "zu",
    "zum",
    "zur",
    "fuer",
    "für",
    "von",
    "vom",
    "mein",
    "meine",
    "meinen",
    "wo",
    "was",
    "ist",
    "sind",
    "gibt",
    "es",
    "bitte",
    "how",
    "do",
    "i",
    "to",
    "the",
    "a",
    "an",
    "of",
    "my",
    "can",
  ].map((word) => commandNeedle(word)),
);

const FOLDED_GROUPS = SYNONYM_GROUPS.map((group) => [
  ...new Set(group.map((term) => commandNeedle(term))),
]);

type Scorable = { label: string; group: string; hint: string; keywords: string[]; blob: string };

const scorables = new WeakMap<FeatureEntry, Scorable>();

function scorableOf(entry: FeatureEntry): Scorable {
  let item = scorables.get(entry);
  if (!item) {
    item = {
      label: entry.title,
      group: entry.area,
      hint: entry.summary,
      keywords: [...entry.keywords, entry.id],
      blob: commandNeedle(
        [entry.title, entry.area, entry.summary, ...entry.keywords, entry.id].join(" "),
      ),
    };
    scorables.set(entry, item);
  }
  return item;
}

const byId = new Map<string, FeatureEntry>(FEATURE_CATALOG.map((entry) => [entry.id, entry]));

export function featureById(id: string): FeatureEntry | undefined {
  return byId.get(id);
}

export function featuresByArea(
  entries: readonly FeatureEntry[] = FEATURE_CATALOG,
): Map<FeatureArea, FeatureEntry[]> {
  const result = new Map<FeatureArea, FeatureEntry[]>(FEATURE_AREAS.map((area) => [area, []]));
  for (const entry of entries) result.get(entry.area)?.push(entry);
  return result;
}

export function featureAnchorId(entry: FeatureEntry): string {
  return entry.anchor ?? entry.id;
}

export function featureAvailable(
  entry: FeatureEntry,
  { capabilities, easyMode }: Pick<FeatureSearchOptions, "capabilities" | "easyMode">,
): boolean {
  if (easyMode && entry.hiddenInEasyMode) return false;
  if (capabilities === undefined || !entry.capability) return true;
  if (!capabilities) return false;
  if (entry.capability === "sql") return capabilities.query_language === "sql";
  return (capabilities as Capabilities)[entry.capability] === true;
}

function prefixRelated(token: string, term: string): boolean {
  if (token.length < 3 || term.length < 3) return token === term;
  return term.startsWith(token) || token.startsWith(term);
}

export function expandSearchToken(token: string): string[] {
  const variants = new Set([token]);
  for (const group of FOLDED_GROUPS) {
    if (group.some((term) => prefixRelated(token, term)))
      for (const term of group) variants.add(term);
  }
  return [...variants];
}

export function searchTokens(query: string): string[] {
  const needle = commandNeedle(query);
  if (!needle) return [];
  const tokens = needle
    .split(/[\s,.;:!?/()"'-]+/)
    .filter((token) => token && !STOPWORDS.has(token));
  return tokens.length > 0 ? tokens : needle.split(/\s+/).filter(Boolean);
}

export function searchFeatures(
  query: string,
  options: FeatureSearchOptions = {},
  entries: readonly FeatureEntry[] = FEATURE_CATALOG,
): FeatureEntry[] {
  const limit = Math.max(0, options.limit ?? DEFAULT_SEARCH_LIMIT);
  const areas = options.areas ? new Set(options.areas) : null;
  const candidates = entries.filter(
    (entry) => (!areas || areas.has(entry.area)) && featureAvailable(entry, options),
  );
  const needle = commandNeedle(query);
  if (!needle) return candidates.slice(0, limit);
  const tokens = searchTokens(query).map(expandSearchToken);
  const required = Math.max(1, Math.ceil(tokens.length / 2));
  const scored: { entry: FeatureEntry; score: number }[] = [];
  for (const entry of candidates) {
    const item = scorableOf(entry);
    const whole = scoreNeedle(needle, item);
    let sum = 0;
    let matched = 0;
    for (const variants of tokens) {
      let best = 0;
      for (let index = 0; index < variants.length; index++) {
        const variant = variants[index];
        if (index > 0 && !item.blob.includes(variant)) continue;
        const score = scoreNeedle(variant, item);
        if (score > best) best = score;
      }
      if (best >= MIN_TOKEN_SCORE) {
        matched++;
        sum += best;
      }
    }
    const tokenScore = matched >= required ? (sum / tokens.length) * (matched / tokens.length) : 0;
    const score = Math.max(whole >= MIN_TOKEN_SCORE ? whole : 0, tokenScore);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.entry.size === "major" ? -1 : 0) - (b.entry.size === "major" ? -1 : 0) ||
      a.entry.title.length - b.entry.title.length,
  );
  return scored.slice(0, limit).map(({ entry }) => entry);
}

export function newestFeatures(
  limit = 6,
  entries: readonly FeatureEntry[] = FEATURE_CATALOG,
): FeatureEntry[] {
  return entries
    .filter((entry) => entry.since)
    .sort((a, b) => compareVersions(b.since ?? "0", a.since ?? "0"))
    .slice(0, limit);
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

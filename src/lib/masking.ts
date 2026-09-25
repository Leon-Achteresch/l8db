export type MaskMode = "text" | "null" | "hash" | "partial" | "fake" | "shuffle";

export const MASK_MODES: { value: MaskMode; label: string }[] = [
  { value: "text", label: "Fester Text" },
  { value: "null", label: "NULL" },
  { value: "hash", label: "Hash" },
  { value: "partial", label: "Teilmaske" },
  { value: "fake", label: "Ersatzwert" },
  { value: "shuffle", label: "Mischen" },
];

export interface ColumnMask {
  column: string;
  mode: MaskMode;
  text?: string | null;
}

export interface MaskRule {
  name: string;
  pattern: string;
  enabled: boolean;
  mask?: MaskMode | null;
}

export const DEFAULT_MASK_TEXT = "***";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  return hash;
}

export function hashText(text: string): string {
  return fnv1a(text).toString(16).padStart(16, "0");
}

export function partialMask(text: string): string {
  const at = text.indexOf("@");
  if (at >= 0) {
    const first = Array.from(text.slice(0, at))[0] ?? "";
    return `${first}***${text.slice(at)}`;
  }
  const chars = Array.from(text);
  if (chars.length === 0) return "";
  if (chars.length <= 3) return "***";
  if (chars.length <= 6) return `${chars[0]}***`;
  return `${chars[0]}***${chars[chars.length - 1]}`;
}

const FIRST = ["Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Jonas", "Laura", "Paul"];
const LAST = ["Müller", "Schmidt", "Fischer", "Weber", "Wagner", "Becker", "Koch", "Richter"];
const CITIES = ["Berlin", "Hamburg", "München", "Köln", "Leipzig", "Bremen", "Dresden", "Bonn"];
const STREETS = ["Hauptstraße", "Gartenweg", "Bahnhofstraße", "Lindenallee", "Am Markt"];
const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit"];

function ascii(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function digitsFrom(hash: bigint, count: number): string {
  return (hash % 10n ** BigInt(count)).toString().padStart(count, "0");
}

export function fakeValue(column: string, text: string): string {
  const hash = fnv1a(`${column}\u0001${text}`);
  const pick = <T>(list: T[], salt: bigint) => list[Number((hash / salt) % BigInt(list.length))];
  const first = pick(FIRST, 1n);
  const last = pick(LAST, 7n);
  const name = column.toLowerCase();
  if (/e[_-]?mail|mail/.test(name))
    return `${ascii(first)}.${ascii(last)}${digitsFrom(hash, 3)}@example.de`;
  if (/first[_-]?name|vorname|given/.test(name)) return first;
  if (/last[_-]?name|nachname|surname|family/.test(name)) return last;
  if (/phone|telefon|mobile|handy|fax|\btel\b/.test(name))
    return `+49 1${digitsFrom(hash, 2)} ${digitsFrom(hash / 100n, 7)}`;
  if (/iban/.test(name)) return `DE00${digitsFrom(hash, 18)}`;
  if (/city|stadt|\bort\b/.test(name)) return pick(CITIES, 3n);
  if (/street|stra(ss|ß)e|address|adresse/.test(name))
    return `${pick(STREETS, 5n)} ${Number(hash % 150n) + 1}`;
  if (/zip|plz|postal/.test(name)) return digitsFrom(hash, 5);
  if (/name|kunde|customer/.test(name)) return `${first} ${last}`;
  if (/^-?\d+(\.\d+)?$/.test(text)) return digitsFrom(hash, Math.max(1, Math.min(12, text.length)));
  return `${pick(WORDS, 11n)} ${pick(WORDS, 13n)}`;
}

export function maskValue(column: string, value: unknown, mask: ColumnMask): unknown {
  if (mask.mode === "null") return null;
  if (mask.mode === "text") return mask.text ?? "";
  if (value === null || value === undefined) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (mask.mode === "hash") return hashText(text);
  if (mask.mode === "partial") return partialMask(text);
  if (mask.mode === "fake") return fakeValue(column, text);
  return value;
}

function shuffled<T>(values: T[], seed: bigint): T[] {
  const out = [...values];
  let state = seed | 1n;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 6364136223846793005n + 1442695040888963407n) & MASK_64;
    const j = Number((state >> 33n) % BigInt(i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function applyMasks(
  columns: string[],
  rows: Record<string, unknown>[],
  masks: ColumnMask[],
  seed = 0,
): Record<string, unknown>[] {
  if (masks.length === 0) return rows;
  const active = masks.filter((mask) => columns.includes(mask.column));
  if (active.length === 0) return rows;
  const shuffledColumns = new Map<string, unknown[]>();
  for (const mask of active) {
    if (mask.mode !== "shuffle") continue;
    shuffledColumns.set(
      mask.column,
      shuffled(
        rows.map((row) => row[mask.column]),
        fnv1a(mask.column) ^ BigInt(seed),
      ),
    );
  }
  return rows.map((row, index) => {
    const out: Record<string, unknown> = { ...row };
    for (const mask of active) {
      out[mask.column] =
        mask.mode === "shuffle"
          ? shuffledColumns.get(mask.column)?.[index]
          : maskValue(mask.column, row[mask.column], mask);
    }
    return out;
  });
}

export function ruleRegex(pattern: string): RegExp | null {
  const source = pattern.trim();
  if (!source) return null;
  try {
    return new RegExp(source.replace(/^\(\?i\)/, ""), "i");
  } catch {
    return null;
  }
}

export function resolveMasks(
  columns: string[],
  rules: MaskRule[],
  replacement = DEFAULT_MASK_TEXT,
): ColumnMask[] {
  const compiled = rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ rule, regex: ruleRegex(rule.pattern) }))
    .filter((entry): entry is { rule: MaskRule; regex: RegExp } => entry.regex !== null);
  return columns.flatMap((column) => {
    const hit = compiled.find((entry) => entry.regex.test(column));
    if (!hit) return [];
    const mode = hit.rule.mask ?? "text";
    return [{ column, mode, text: mode === "text" ? replacement : null }];
  });
}

export interface RegexSearchOptions {
  caseSensitive?: boolean;
  multiline?: boolean;
  dotAll?: boolean;
  global?: boolean;
}

export interface RegexCompileError {
  message: string;
  index: number | null;
}

export type RegexCompileResult =
  | { ok: true; regex: RegExp; flags: string }
  | { ok: false; error: RegexCompileError };

export type SearchPatternCompileResult =
  | { ok: true; regexes: RegExp[]; flags: string }
  | { ok: false; error: RegexCompileError };

export interface RegexPatternTemplate {
  id: string;
  label: string;
  pattern: string;
  description: string;
}

export const REGEX_PATTERN_LIBRARY: RegexPatternTemplate[] = [
  {
    id: "digits",
    label: "Ziffernfolge",
    pattern: "\\d+",
    description: "Eine oder mehrere Ziffern",
  },
  {
    id: "decimal",
    label: "Dezimalzahl",
    pattern: "-?\\d+(?:[.,]\\d+)?",
    description: "Zahl mit optionalem Vorzeichen und Nachkommastellen",
  },
  {
    id: "word",
    label: "Wort",
    pattern: "\\w+",
    description: "Buchstaben, Ziffern oder Unterstrich",
  },
  {
    id: "whole-word",
    label: "Ganzes Wort",
    pattern: "\\bWORT\\b",
    description: "Treffer nur an Wortgrenzen",
  },
  {
    id: "line-start",
    label: "Zeilenanfang",
    pattern: "^",
    description: "Verankert am Zeilenanfang",
  },
  {
    id: "line-end",
    label: "Zeilenende",
    pattern: "$",
    description: "Verankert am Zeilenende",
  },
  {
    id: "trailing-space",
    label: "Leerzeichen am Zeilenende",
    pattern: "[ \\t]+$",
    description: "Überflüssige Leerzeichen vor dem Zeilenumbruch",
  },
  {
    id: "quoted",
    label: "Zeichenkette in Hochkommas",
    pattern: "'(?:[^']|'')*'",
    description: "SQL-Literal inklusive verdoppelter Hochkommas",
  },
  {
    id: "sql-comment",
    label: "SQL-Kommentar",
    pattern: "--.*$",
    description: "Zeilenkommentar bis zum Zeilenende",
  },
  {
    id: "email",
    label: "E-Mail",
    pattern: "[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}",
    description: "Einfache E-Mail-Adresse",
  },
  {
    id: "uuid",
    label: "UUID",
    pattern: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    description: "UUID im Standardformat",
  },
  {
    id: "iso-date",
    label: "Datum ISO",
    pattern: "\\d{4}-\\d{2}-\\d{2}",
    description: "Datum im Format JJJJ-MM-TT",
  },
  {
    id: "alternative",
    label: "Alternative",
    pattern: "(?:A|B)",
    description: "Entweder A oder B",
  },
  {
    id: "optional-group",
    label: "Optionale Gruppe",
    pattern: "(?:TEXT)?",
    description: "Teil darf fehlen",
  },
  {
    id: "any-chars",
    label: "Beliebige Zeichen",
    pattern: ".*?",
    description: "Möglichst kurze Zeichenfolge",
  },
];

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitSearchPatterns(raw: string): string[] {
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeSearchPattern(pattern: string): string {
  if (!pattern.includes("*") || /[\\.+?^${}()[\]|{}]/.test(pattern)) return pattern;
  return pattern.split("*").map(escapeRegexLiteral).join(".*");
}

export function compileSearchPatterns(
  raw: string,
  options: RegexSearchOptions = {},
): SearchPatternCompileResult {
  const patterns = splitSearchPatterns(raw);
  if (patterns.length === 0) {
    return { ok: false, error: { message: "Muster ist leer.", index: null } };
  }
  const regexes: RegExp[] = [];
  let offset = 0;
  for (const pattern of patterns) {
    const compiled = compileRegexSearch(normalizeSearchPattern(pattern), options);
    if (!compiled.ok) {
      return {
        ok: false,
        error:
          compiled.error.index === null
            ? compiled.error
            : { ...compiled.error, index: offset + compiled.error.index },
      };
    }
    regexes.push(compiled.regex);
    offset += pattern.length + 1;
  }
  return { ok: true, regexes, flags: regexSearchFlags(options) };
}

export function regexSearchFlags(options: RegexSearchOptions = {}): string {
  let flags = options.global === false ? "" : "g";
  if (!options.caseSensitive) flags += "i";
  if (options.multiline) flags += "m";
  if (options.dotAll) flags += "s";
  return flags;
}

function isQuantifierStart(char: string): boolean {
  return char === "*" || char === "+" || char === "?";
}

function scanRegexIssue(pattern: string): RegexCompileError | null {
  const openGroups: number[] = [];
  let classStart = -1;
  let previousToken: "none" | "atom" | "quantifier" = "none";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === "\\") {
      if (index === pattern.length - 1) {
        return { message: "Offene Escape-Sequenz am Ende des Musters.", index };
      }
      index += 1;
      previousToken = "atom";
      continue;
    }

    if (classStart >= 0) {
      if (char === "]") {
        classStart = -1;
        previousToken = "atom";
      }
      continue;
    }

    if (char === "[") {
      classStart = index;
      continue;
    }

    if (char === "(") {
      openGroups.push(index);
      previousToken = "none";
      continue;
    }

    if (char === ")") {
      if (openGroups.length === 0) {
        return { message: "Schließende Klammer ohne passende öffnende Klammer.", index };
      }
      openGroups.pop();
      previousToken = "atom";
      continue;
    }

    if (char === "|") {
      previousToken = "none";
      continue;
    }

    if (isQuantifierStart(char)) {
      if (previousToken === "none") {
        return { message: "Quantifizierer ohne vorangehendes Zeichen.", index };
      }
      if (previousToken === "quantifier" && char !== "?") {
        return { message: "Mehrfacher Quantifizierer an derselben Stelle.", index };
      }
      previousToken = "quantifier";
      continue;
    }

    if (char === "{") {
      const close = pattern.indexOf("}", index);
      const body = close < 0 ? "" : pattern.slice(index + 1, close);
      const range = /^(\d+)(?:,(\d*))?$/.exec(body);
      if (close >= 0 && range) {
        if (previousToken === "none") {
          return { message: "Quantifizierer ohne vorangehendes Zeichen.", index };
        }
        const min = Number(range[1]);
        const max = range[2] === undefined || range[2] === "" ? null : Number(range[2]);
        if (max !== null && max < min) {
          return {
            message: "Ungültiger Wiederholungsbereich: Maximum kleiner als Minimum.",
            index,
          };
        }
        index = close;
        previousToken = "quantifier";
        continue;
      }
      previousToken = "atom";
      continue;
    }

    previousToken = "atom";
  }

  if (classStart >= 0) {
    return { message: "Zeichenklasse wurde nicht geschlossen.", index: classStart };
  }
  if (openGroups.length > 0) {
    return {
      message: "Gruppe wurde nicht geschlossen.",
      index: openGroups[openGroups.length - 1],
    };
  }
  return null;
}

function cleanNativeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const stripped = raw.replace(/^Invalid regular expression:\s*\/.*\/[a-z]*:\s*/i, "");
  return stripped.trim() === "" ? "Ungültiger regulärer Ausdruck." : stripped.trim();
}

export function compileRegexSearch(
  pattern: string,
  options: RegexSearchOptions = {},
): RegexCompileResult {
  const flags = regexSearchFlags(options);
  if (pattern === "") {
    return { ok: false, error: { message: "Muster ist leer.", index: null } };
  }
  try {
    return { ok: true, regex: new RegExp(pattern, flags), flags };
  } catch (error) {
    const scanned = scanRegexIssue(pattern);
    return {
      ok: false,
      error: scanned ?? { message: cleanNativeMessage(error), index: null },
    };
  }
}

export function describeRegexError(error: RegexCompileError): string {
  if (error.index === null) return error.message;
  return `${error.message} (Position ${error.index + 1})`;
}

export function countRegexMatches(values: string[], regex: RegExp): number {
  if (!regex.global) {
    return values.reduce((total, value) => total + (regex.test(value) ? 1 : 0), 0);
  }
  let count = 0;
  for (const value of values) {
    regex.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = regex.exec(value)) !== null) {
      count += 1;
      if (hit[0].length === 0) regex.lastIndex += 1;
      if (count > 100000) return count;
    }
  }
  return count;
}

export function insertRegexPattern(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  snippet: string,
): { value: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
  return { value: next, cursor: start + snippet.length };
}

export function regexLiteralPrefilter(pattern: string): string {
  let best = "";
  let current = "";
  let classDepth = 0;

  const flush = (trimLast: boolean) => {
    const candidate = trimLast ? current.slice(0, -1) : current;
    if (candidate.length > best.length) best = candidate;
    current = "";
  };

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      flush(false);
      index += 1;
      continue;
    }
    if (classDepth > 0) {
      if (char === "]") classDepth -= 1;
      continue;
    }
    if (char === "[") {
      flush(false);
      classDepth += 1;
      continue;
    }
    if (isQuantifierStart(char) || char === "{") {
      flush(current.length > 0);
      continue;
    }
    if ("()|^$.".includes(char)) {
      flush(false);
      continue;
    }
    current += char;
  }
  flush(false);
  return best;
}

import { compileRegexSearch } from "./compile";
import type { RegexSearchOptions, SearchPatternCompileResult } from "./types";

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
  if (/[\\.+?^${}()[\]|{}]/.test(pattern)) return pattern;
  const wildcardPattern = pattern.split("*").map(escapeRegexLiteral).join(".*");
  return `^${wildcardPattern}$`;
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

import { regexSearchFlags } from "./patterns";
import { isQuantifierStart, scanRegexIssue } from "./scan-issue";
import type { RegexCompileError, RegexCompileResult, RegexSearchOptions } from "./types";

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

function optionalAfter(pattern: string, index: number): boolean {
  const next = pattern[index];
  if (next === "?" || next === "*") return true;
  const bounds = next === "{" ? /^\{(\d+)(,\d*)?\}/.exec(pattern.slice(index)) : null;
  return bounds !== null && Number(bounds[1]) === 0;
}

export function regexLiteralPrefilter(pattern: string): string {
  let best = "";
  let current = "";
  const groups: { best: string; lookaround: boolean }[] = [];

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
    if (char === "[") {
      flush(false);
      for (index += 1; index < pattern.length && pattern[index] !== "]"; index += 1)
        if (pattern[index] === "\\") index += 1;
      continue;
    }
    if (char === "|") return "";
    if (char === "(") {
      flush(false);
      let lookaround = false;
      if (pattern[index + 1] === "?") {
        const rest = pattern.slice(index + 2);
        if (rest.startsWith(":")) index += 2;
        else if (/^<[A-Za-z_$]/.test(rest)) index = pattern.indexOf(">", index);
        else {
          lookaround = true;
          index += rest.startsWith("<") ? 3 : 2;
        }
      }
      groups.push({ best, lookaround });
      continue;
    }
    if (char === ")") {
      flush(false);
      const group = groups.pop();
      if (group && (group.lookaround || optionalAfter(pattern, index + 1))) best = group.best;
      continue;
    }
    if (isQuantifierStart(char) || char === "{") {
      flush(current.length > 0);
      const bounds = char === "{" ? /^\{\d+(,\d*)?\}/.exec(pattern.slice(index)) : null;
      if (bounds) index += bounds[0].length - 1;
      continue;
    }
    if ("^$.".includes(char)) {
      flush(false);
      continue;
    }
    current += char;
  }
  flush(false);
  return best;
}

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

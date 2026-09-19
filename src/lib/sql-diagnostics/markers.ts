import type { DatabaseKind } from "@/lib/db";

export interface SqlMarker {
  start: number;
  end: number;
  message: string;
  severity: "error" | "warning";
}

export function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

export function lineEnd(text: string, offset: number): number {
  const end = text.indexOf("\n", offset);
  return end < 0 ? text.length : end;
}

export function skipTrivia(text: string): number {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith("--", i)) i = lineEnd(text, i);
    else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else return i;
  }
}

function markAt(text: string, offset: number): { start: number; end: number } {
  const token = /[\w$#]+|"[^"\n]*"?|'[^'\n]*'?/y;
  token.lastIndex = offset;
  const match = token.exec(text);
  if (match) return { start: offset, end: offset + match[0].length };
  const end = lineEnd(text, offset);
  if (end > offset) return { start: offset, end };
  const start = lineStart(text, offset);
  return start < offset ? { start, end: offset } : { start: offset, end: offset + 1 };
}

function offsetOf(text: string, anchor: number, line: number, column: number): number | null {
  let start = anchor;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return null;
    start = next + 1;
  }
  return Math.min(start + Math.max(column, 1) - 1, lineEnd(text, start));
}

const LINE_COLUMN = /(?:line|zeile)\s+(\d+),\s*(?:column|spalte)\s+(\d+):?/gi;

export function sqlErrorMarkers(
  message: string,
  text: string,
  base = 0,
  kind?: DatabaseKind | null,
): SqlMarker[] {
  const anchor = kind === "oracle" ? skipTrivia(text) : 0;
  const summary = message.split("\n")[0];
  const markers: SqlMarker[] = [];
  const matches = [...message.matchAll(LINE_COLUMN)];
  matches.forEach((match, i) => {
    const offset = offsetOf(text, anchor, Number(match[1]), Number(match[2]));
    if (offset === null) return;
    const detail = message
      .slice((match.index ?? 0) + match[0].length, matches[i + 1]?.index ?? message.length)
      .split("\n")
      .map((line) => line.replace(/^ORA-06550:?\s*$/, "").trim())
      .filter(Boolean)
      .join("\n");
    const detailText = detail || summary;
    markers.push({
      ...markAt(text, offset),
      message: detailText,
      severity: /^PLW-/.test(detailText) ? "warning" : "error",
    });
  });
  if (markers.length === 0) {
    const position = /Position: (\d+)/.exec(message);
    const line = /\bat line (\d+)|\(line (\d+)\)/.exec(message);
    if (position) {
      const offset = Math.min(anchor + Number(position[1]) - 1, text.length);
      markers.push({ ...markAt(text, offset), message: summary, severity: "error" });
    } else if (line) {
      const offset = offsetOf(text, 0, Number(line[1] ?? line[2]), 1);
      if (offset !== null) {
        markers.push({
          start: offset,
          end: lineEnd(text, offset),
          message: summary,
          severity: "error",
        });
      }
    }
  }
  return markers.map((marker) => ({
    ...marker,
    start: marker.start + base,
    end: marker.end + base,
  }));
}

function escapeIdent(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headerSpan(text: string): { start: number; end: number } {
  const match =
    /\b(?:CREATE\b[\s\S]*?\b)?(?:FUNCTION|PROCEDURE|PACKAGE(?:\s+BODY)?)\s+"?[\w$#]+"?/i.exec(text);
  if (match) return markAt(text, match.index + match[0].search(/[\w$#"]+$/));
  return markAt(text, skipTrivia(text));
}

function locateDeclaration(text: string, name: string): { start: number; end: number } | null {
  const ident = escapeIdent(name.replaceAll('"', ""));
  const declared = new RegExp(
    String.raw`(FUNCTION|PROCEDURE|PACKAGE(?:\s+BODY)?)\s+("?${ident}"?)`,
    "i",
  ).exec(text);
  if (declared) {
    const token = declared[2];
    const start = declared.index + declared[0].length - token.length;
    return { start, end: start + token.length };
  }
  const word = new RegExp(String.raw`"${ident}"|\b${ident}\b`, "i").exec(text);
  return word ? { start: word.index, end: word.index + word[0].length } : null;
}

const CALLER_LINE = /^Aufrufer\s+(\S+)\s+\(([^)]+)\):\s*(.*)$/;

export function impactCallMarkers(message: string, text: string): SqlMarker[] {
  const markers: SqlMarker[] = [];
  for (const raw of message.split("\n")) {
    const line = CALLER_LINE.exec(raw.trim());
    if (!line) continue;
    const detail = line[3];
    const quoted = [...detail.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const span =
      quoted.map((name) => locateDeclaration(text, name)).find((found) => found !== null) ??
      headerSpan(text);
    markers.push({
      ...span,
      message: `${line[1]} (${line[2]}): ${detail}`,
      severity: "error",
    });
  }
  return markers;
}

export function locateText(haystack: string, needle: string, near: number): number | null {
  let best: number | null = null;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) {
    if (best === null || Math.abs(i - near) < Math.abs(best - near)) best = i;
  }
  return best;
}

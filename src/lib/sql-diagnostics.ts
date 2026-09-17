import type { DatabaseKind } from "@/lib/db";

export interface SqlMarker {
  start: number;
  end: number;
  message: string;
  severity: "error" | "warning";
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
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

interface Token {
  upper: string;
  start: number;
  end: number;
}

type BlockKind =
  | "BEGIN"
  | "DECLARE"
  | "SUBPROGRAM"
  | "PACKAGE"
  | "COMPOUND"
  | "IF"
  | "LOOP"
  | "CASE";

interface Block {
  kind: BlockKind;
  token: Token;
}

const CLOSE_QUOTE: Record<string, string> = { "[": "]", "(": ")", "{": "}", "<": ">" };

function tokenize(src: string, findings: SqlMarker[]): Token[] {
  const tokens: Token[] = [];
  const word = /[A-Za-z_$][\w$#]*/y;
  const punct = /:=|=>|<>|!=|\^=|~=|<=|>=|\|\||\.\./y;
  let i = 0;
  const error = (start: number, message: string) =>
    findings.push({
      start,
      end: Math.max(lineEnd(src, start), start + 1),
      message,
      severity: "error",
    });
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith("--", i)) {
      i = lineEnd(src, i);
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) error(i, "Kommentar wird nicht geschlossen");
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    const q = /[nN]?[qQ]'(.)/y;
    q.lastIndex = i;
    const quoted = q.exec(src);
    if (quoted) {
      const close = `${CLOSE_QUOTE[quoted[1]] ?? quoted[1]}'`;
      const end = src.indexOf(close, i + quoted[0].length);
      if (end < 0) error(i, "Zeichenkette wird nicht geschlossen");
      tokens.push({ upper: "'", start: i, end: end < 0 ? src.length : end + 2 });
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        const end = src.indexOf(c, j);
        if (end < 0) {
          error(
            i,
            c === "'" ? "Zeichenkette wird nicht geschlossen" : "Bezeichner wird nicht geschlossen",
          );
          j = src.length;
          break;
        }
        if (src[end + 1] === c) j = end + 2;
        else {
          j = end + 1;
          break;
        }
      }
      tokens.push({ upper: c, start: i, end: j });
      i = j;
      continue;
    }
    word.lastIndex = i;
    punct.lastIndex = i;
    const match = word.exec(src) ?? punct.exec(src);
    const end = match ? i + match[0].length : i + 1;
    tokens.push({ upper: src.slice(i, end).toUpperCase(), start: i, end });
    i = end;
  }
  return tokens;
}

const OPENER_HINT: Record<BlockKind, string> = {
  BEGIN: "BEGIN ohne passendes END",
  DECLARE: "DECLARE ohne BEGIN … END",
  SUBPROGRAM: "Unterprogramm ohne BEGIN … END",
  PACKAGE: "Package ohne abschließendes END",
  COMPOUND: "Compound Trigger ohne abschließendes END",
  IF: "IF ohne END IF",
  LOOP: "LOOP ohne END LOOP",
  CASE: "CASE ohne END",
};

export function lintPlsql(src: string): SqlMarker[] {
  const findings: SqlMarker[] = [];
  const tokens = tokenize(src, findings);
  const blocks: Block[] = [];
  const parens: Token[] = [];
  let pendingHeader: "SUBPROGRAM" | "PACKAGE" | null = null;
  let headerDepth = 0;
  let inSet = false;

  const add = (token: Token, message: string, severity: SqlMarker["severity"] = "error") =>
    findings.push({ start: token.start, end: token.end, message, severity });
  const unclosed = (from: number) => {
    for (const block of blocks.splice(from)) add(block.token, OPENER_HINT[block.kind]);
  };
  const flushParens = () => {
    for (const paren of parens.splice(0)) add(paren, "Klammer wird nicht geschlossen");
  };
  const findBlock = (kinds: BlockKind[]) => {
    for (let i = blocks.length - 1; i >= 0; i--) if (kinds.includes(blocks[i].kind)) return i;
    return -1;
  };
  const expectSemicolon = (token: Token, index: number, label: string) => {
    let next = tokens[index];
    if (
      next &&
      /^[A-Z_$"]/.test(next.upper) &&
      !["END", "BEGIN", "IF", "LOOP"].includes(next.upper)
    ) {
      next = tokens[index + 1];
    }
    if (next?.upper !== ";") add(token, `Semikolon nach ${label} fehlt`);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const prev = tokens[i - 1]?.upper;
    const next = tokens[i + 1]?.upper;
    const isSlashLine =
      token.upper === "/" &&
      src.slice(lineStart(src, token.start), token.start).trim() === "" &&
      src.slice(token.end, lineEnd(src, token.end)).trim() === "";
    if (isSlashLine) {
      unclosed(0);
      flushParens();
      pendingHeader = null;
      inSet = false;
      continue;
    }
    switch (token.upper) {
      case "(":
        parens.push(token);
        break;
      case ")":
        if (!parens.pop()) add(token, "Schließende Klammer ohne öffnende Klammer");
        break;
      case ";":
        flushParens();
        pendingHeader = null;
        inSet = false;
        break;
      case "SET":
        inSet = true;
        break;
      case "WHERE":
        inSet = false;
        break;
      case "PROCEDURE":
      case "FUNCTION":
        if (prev !== "END") {
          pendingHeader = "SUBPROGRAM";
          headerDepth = parens.length;
        }
        break;
      case "PACKAGE":
        pendingHeader = "PACKAGE";
        headerDepth = parens.length;
        break;
      case "TYPE":
        if (next === "BODY") {
          pendingHeader = "PACKAGE";
          headerDepth = parens.length;
        }
        break;
      case "IS":
      case "AS":
        if (pendingHeader && parens.length === headerDepth) {
          if (next !== "LANGUAGE" && next !== "EXTERNAL") {
            blocks.push({ kind: pendingHeader, token });
          }
          pendingHeader = null;
        } else if (
          token.upper === "IS" &&
          (prev === "ROW" || prev === "STATEMENT") &&
          blocks.at(-1)?.kind === "COMPOUND"
        ) {
          blocks.push({ kind: "SUBPROGRAM", token });
        }
        break;
      case "COMPOUND":
        if (next === "TRIGGER") blocks.push({ kind: "COMPOUND", token });
        break;
      case "DECLARE":
        blocks.push({ kind: "DECLARE", token });
        break;
      case "BEGIN": {
        const top = blocks.at(-1);
        if (
          top &&
          (top.kind === "DECLARE" || top.kind === "SUBPROGRAM" || top.kind === "PACKAGE")
        ) {
          blocks[blocks.length - 1] = { kind: "BEGIN", token };
        } else blocks.push({ kind: "BEGIN", token });
        break;
      }
      case "IF":
        if (next === "EXISTS" || (next === "NOT" && tokens[i + 2]?.upper === "EXISTS")) break;
        if (prev === "ELSE")
          add(
            token,
            "ELSE IF öffnet ein neues IF (braucht eigenes END IF) – ELSIF gemeint?",
            "warning",
          );
        blocks.push({ kind: "IF", token });
        break;
      case "ELSEIF":
        add(token, "ELSEIF gibt es in PL/SQL nicht – ELSIF verwenden");
        break;
      case "LOOP":
      case "CASE":
        blocks.push({ kind: token.upper as BlockKind, token });
        break;
      case "END": {
        if (next === "IF" || next === "LOOP" || next === "CASE") {
          const index = findBlock([next]);
          if (index < 0) add(token, `END ${next} ohne passendes ${next}`);
          else {
            unclosed(index + 1);
            blocks.pop();
          }
          expectSemicolon(token, i + 2, `END ${next}`);
          i++;
          break;
        }
        const index = findBlock(["BEGIN", "DECLARE", "SUBPROGRAM", "PACKAGE", "COMPOUND", "CASE"]);
        if (index < 0) {
          add(token, "END ohne passenden Blockanfang");
          break;
        }
        unclosed(index + 1);
        const block = blocks.pop();
        if (block?.kind === "CASE") break;
        if (next === "BEFORE" || next === "AFTER" || next === "INSTEAD") break;
        expectSemicolon(token, i + 1, "END");
        break;
      }
      case "OTHERS":
        if (
          prev === "WHEN" &&
          next === "THEN" &&
          tokens[i + 2]?.upper === "NULL" &&
          tokens[i + 3]?.upper === ";"
        ) {
          add(tokens[i + 2], "WHEN OTHERS THEN NULL verschluckt alle Fehler", "warning");
        }
        break;
      case "NULL":
        if (
          prev === "<>" ||
          prev === "!=" ||
          prev === "^=" ||
          prev === "~=" ||
          (prev === "=" && !inSet)
        ) {
          add(
            tokens[i - 1],
            `Vergleich "${prev} NULL" ist nie wahr – IS ${prev === "=" ? "" : "NOT "}NULL verwenden`,
            "warning",
          );
        }
        break;
    }
  }
  unclosed(0);
  flushParens();
  return findings.sort((a, b) => a.start - b.start);
}

import { lineEnd, type SqlMarker } from "./markers";

export interface Token {
  upper: string;
  start: number;
  end: number;
}

export type BlockKind =
  | "BEGIN"
  | "DECLARE"
  | "SUBPROGRAM"
  | "PACKAGE"
  | "COMPOUND"
  | "IF"
  | "LOOP"
  | "CASE";

export interface Block {
  kind: BlockKind;
  token: Token;
}

export interface BlockPair {
  open: { start: number; end: number };
  close: { start: number; end: number };
}

const CLOSE_QUOTE: Record<string, string> = { "[": "]", "(": ")", "{": "}", "<": ">" };

export function tokenize(src: string, findings: SqlMarker[]): Token[] {
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

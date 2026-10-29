export type TokenKind = "name" | "string" | "template" | "number" | "regex" | "punct";

export type Token = { kind: TokenKind; value: string; line: number };

export class ScanError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

const EXPRESSION_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const IDENT_START = /[\p{ID_Start}$_]/u;
const IDENT_PART = /[\p{ID_Continue}$‌‍]/u;
const SPACE = /[\s﻿]/;

function decodeEscape(code: string, index: number): [string, number] {
  const next = code[index + 1];
  if (next === "x")
    return [String.fromCharCode(Number.parseInt(code.slice(index + 2, index + 4), 16)), 4];
  if (next === "u" && code[index + 2] === "{") {
    const end = code.indexOf("}", index + 3);
    return [
      String.fromCodePoint(Number.parseInt(code.slice(index + 3, end), 16) || 0),
      end - index + 1,
    ];
  }
  if (next === "u")
    return [String.fromCharCode(Number.parseInt(code.slice(index + 2, index + 6), 16)), 6];
  return [next ?? "", 2];
}

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  const braces: ("brace" | "template")[] = [];
  const length = code.length;
  let index = 0;
  let line = 1;

  const regexAllowed = () => {
    const last = tokens[tokens.length - 1];
    if (!last) return true;
    if (last.kind === "name") return EXPRESSION_KEYWORDS.has(last.value);
    if (last.kind !== "punct") return false;
    return last.value !== ")" && last.value !== "]";
  };

  const readTemplate = () => {
    const start = line;
    let value = "";
    while (index < length) {
      const char = code[index];
      if (char === "\\") {
        const [decoded, size] = decodeEscape(code, index);
        if (code[index + 1] === "\n") line++;
        value += decoded;
        index += size;
        continue;
      }
      if (char === "`") {
        index++;
        tokens.push({ kind: "template", value, line: start });
        return;
      }
      if (char === "$" && code[index + 1] === "{") {
        index += 2;
        braces.push("template");
        tokens.push({ kind: "template", value, line: start });
        return;
      }
      if (char === "\n") line++;
      value += char;
      index++;
    }
    throw new ScanError("Template-String ohne Ende", start);
  };

  while (index < length) {
    const char = code[index];
    if (char === "\n") {
      line++;
      index++;
      continue;
    }
    if (SPACE.test(char)) {
      index++;
      continue;
    }
    if (char === "/" && code[index + 1] === "/") {
      while (index < length && code[index] !== "\n") index++;
      continue;
    }
    if (char === "/" && code[index + 1] === "*") {
      const end = code.indexOf("*/", index + 2);
      if (end < 0) throw new ScanError("Kommentar ohne Ende", line);
      for (let cursor = index; cursor < end; cursor++) if (code[cursor] === "\n") line++;
      index = end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const start = line;
      let value = "";
      index++;
      while (index < length && code[index] !== char) {
        if (code[index] === "\n") throw new ScanError("String ohne Ende", start);
        if (code[index] === "\\") {
          const [decoded, size] = decodeEscape(code, index);
          if (code[index + 1] === "\n") line++;
          value += decoded;
          index += size;
          continue;
        }
        value += code[index];
        index++;
      }
      if (index >= length) throw new ScanError("String ohne Ende", start);
      index++;
      tokens.push({ kind: "string", value, line: start });
      continue;
    }
    if (char === "`") {
      index++;
      readTemplate();
      continue;
    }
    if (char === "{") {
      braces.push("brace");
      tokens.push({ kind: "punct", value: "{", line });
      index++;
      continue;
    }
    if (char === "}") {
      index++;
      if (braces.pop() === "template") readTemplate();
      else tokens.push({ kind: "punct", value: "}", line });
      continue;
    }
    if (char === "/" && regexAllowed()) {
      const start = line;
      let inClass = false;
      let value = "/";
      index++;
      while (index < length) {
        const current = code[index];
        if (current === "\n") throw new ScanError("Regulärer Ausdruck ohne Ende", start);
        value += current;
        index++;
        if (current === "\\") {
          value += code[index] ?? "";
          index++;
        } else if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
      }
      while (index < length && IDENT_PART.test(code[index])) value += code[index++];
      tokens.push({ kind: "regex", value, line: start });
      continue;
    }
    if (char === "\\") throw new ScanError("Unicode-Escapes in Namen sind nicht erlaubt", line);
    if (IDENT_START.test(char)) {
      let value = char;
      index++;
      while (index < length && IDENT_PART.test(code[index])) value += code[index++];
      if (code[index] === "\\")
        throw new ScanError("Unicode-Escapes in Namen sind nicht erlaubt", line);
      tokens.push({ kind: "name", value, line });
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(code[index + 1] ?? ""))) {
      let value = char;
      index++;
      while (index < length && /[\w.]/.test(code[index])) value += code[index++];
      tokens.push({ kind: "number", value, line });
      continue;
    }
    if (char === "?" && code[index + 1] === "." && !/[0-9]/.test(code[index + 2] ?? "")) {
      tokens.push({ kind: "punct", value: "?.", line });
      index += 2;
      continue;
    }
    if (char === "." && code[index + 1] === "." && code[index + 2] === ".") {
      tokens.push({ kind: "punct", value: "...", line });
      index += 3;
      continue;
    }
    tokens.push({ kind: "punct", value: char, line });
    index++;
  }
  return tokens;
}

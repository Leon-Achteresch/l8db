export type SqlFoldKind = "block" | "comment" | "region";

export interface SqlFoldRange {
  start: number;
  end: number;
  kind: SqlFoldKind;
}

interface Opener {
  word: string;
  line: number;
}

const BEGIN_SKIP = new Set(["TRANSACTION", "TRAN", "WORK", "DEFERRED", "IMMEDIATE", "EXCLUSIVE"]);

export function sqlFoldingRanges(text: string): SqlFoldRange[] {
  const ranges: SqlFoldRange[] = [];
  const parens: number[] = [];
  const blocks: Opener[] = [];
  const regions: number[] = [];
  const dollar: { tag: string; line: number }[] = [];
  let line = 1;
  let index = 0;
  let statementStart: number | null = null;
  let lastCodeLine = 1;
  let previousWord = "";
  let lineHasCodeBefore = false;

  const push = (start: number, end: number, kind: SqlFoldKind) => {
    if (end > start) ranges.push({ start, end, kind });
  };
  const nextWord = (from: number) => {
    const match = /^\s*([A-Za-z_]+)/.exec(text.slice(from, from + 64));
    return match ? match[1].toUpperCase() : "";
  };
  const markCode = () => {
    if (statementStart === null) statementStart = line;
    lastCodeLine = line;
    lineHasCodeBefore = true;
  };

  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      line += 1;
      index += 1;
      lineHasCodeBefore = false;
      continue;
    }
    if (char === "-" && text[index + 1] === "-") {
      const end = text.indexOf("\n", index);
      const comment = text.slice(index + 2, end < 0 ? text.length : end).trim();
      if (/^#?\s*region\b/i.test(comment)) regions.push(line);
      else if (/^#?\s*endregion\b/i.test(comment)) {
        const start = regions.pop();
        if (start !== undefined) push(start, line, "region");
      }
      index = end < 0 ? text.length : end;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const startLine = line;
      const end = text.indexOf("*/", index + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (let i = index; i < stop; i += 1) if (text[i] === "\n") line += 1;
      push(startLine, line, "comment");
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      markCode();
      let i = index + 1;
      while (i < text.length) {
        if (text[i] === char) {
          if (text[i + 1] === char) {
            i += 2;
            continue;
          }
          break;
        }
        if (text[i] === "\n") line += 1;
        i += 1;
      }
      index = i + 1;
      continue;
    }
    if (char === "$") {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(index, index + 66));
      if (match) {
        markCode();
        const top = dollar[dollar.length - 1];
        if (top && top.tag === match[0]) {
          dollar.pop();
          push(top.line, line - (lineHasCodeBefore ? 0 : 1), "block");
        } else dollar.push({ tag: match[0], line });
        index += match[0].length;
        continue;
      }
    }
    if (char === "(") {
      markCode();
      parens.push(line);
      index += 1;
      continue;
    }
    if (char === ")") {
      const start = parens.pop();
      if (start !== undefined) push(start, lineHasCodeBefore ? line : line - 1, "block");
      markCode();
      index += 1;
      continue;
    }
    if (char === ";") {
      markCode();
      if (parens.length === 0 && blocks.length === 0 && dollar.length === 0) {
        if (statementStart !== null) push(statementStart, line, "block");
        statementStart = null;
      }
      previousWord = ";";
      index += 1;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$#]*/.exec(text.slice(index, index + 128));
    if (word) {
      const upper = word[0].toUpperCase();
      const atLineStart = !lineHasCodeBefore;
      markCode();
      const after = index + word[0].length;
      if (upper === "BEGIN") {
        const following = nextWord(after);
        const terminated = /^\s*;/.test(text.slice(after, after + 16));
        if (!terminated && !BEGIN_SKIP.has(following)) blocks.push({ word: upper, line });
      } else if (upper === "CASE" && previousWord !== "END") {
        blocks.push({ word: upper, line });
      } else if (upper === "LOOP" && previousWord !== "END") {
        blocks.push({ word: upper, line });
      } else if (upper === "IF" && previousWord !== "END") {
        const following = nextWord(after);
        if (following !== "EXISTS" && following !== "NOT") blocks.push({ word: upper, line });
      } else if (upper === "END") {
        const following = nextWord(after);
        const target =
          following === "IF" || following === "LOOP" || following === "CASE" ? following : null;
        let position = blocks.length - 1;
        while (position >= 0) {
          const opener = blocks[position].word;
          if (target ? opener === target : opener === "BEGIN" || opener === "CASE") break;
          position -= 1;
        }
        if (position >= 0) {
          const opener = blocks[position];
          blocks.length = position;
          push(opener.line, atLineStart ? line - 1 : line, "block");
        }
      }
      previousWord = upper;
      index = after;
      continue;
    }
    if (!/\s/.test(char)) markCode();
    index += 1;
  }
  if (statementStart !== null) push(statementStart, lastCodeLine, "block");

  const byStart = new Map<string, SqlFoldRange>();
  for (const range of ranges) {
    const key = `${range.start}:${range.kind === "comment" ? "c" : "b"}`;
    const existing = byStart.get(key);
    if (!existing || existing.end < range.end) byStart.set(key, range);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start || b.end - a.end);
}

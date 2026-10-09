export type EditResult =
  | { ok: true; text: string; mode: "blocks" | "full" }
  | { ok: false; error: string };

interface EditBlock {
  search: string[];
  replace: string[];
}

const SEARCH_MARK = /^\s*<{5,9}\s*SEARCH\s*$/;
const DIVIDER_MARK = /^\s*={5,9}\s*$/;
const REPLACE_MARK = /^\s*>{5,9}\s*REPLACE\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

export function stripFences(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[][] = [];
  let open: { marker: string; lines: string[] } | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (open) {
      const close = /^(`{3,}|~{3,})$/.exec(line.trim());
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        blocks.push(open.lines);
        open = null;
      } else open.lines.push(line);
    } else if (fence) {
      open = { marker: fence[1], lines: [] };
    }
  }
  if (open) blocks.push(open.lines);
  if (blocks.length === 0) return text.trim();
  let best = blocks[0];
  for (const block of blocks) if (block.join("\n").length > best.join("\n").length) best = block;
  return best.join("\n").replace(/^\n+|\s+$/g, "");
}

function parseBlocks(output: string): EditBlock[] | string | null {
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  const blocks: EditBlock[] = [];
  let state: "outside" | "search" | "replace" = "outside";
  let search: string[] = [];
  let replace: string[] = [];
  for (const line of lines) {
    if (state === "outside") {
      if (SEARCH_MARK.test(line)) {
        state = "search";
        search = [];
        replace = [];
      }
    } else if (state === "search") {
      if (DIVIDER_MARK.test(line)) state = "replace";
      else if (SEARCH_MARK.test(line) || REPLACE_MARK.test(line))
        return `Block ${blocks.length + 1} ist unvollständig: Trennzeile ======= fehlt.`;
      else search.push(line);
    } else if (REPLACE_MARK.test(line)) {
      blocks.push({ search, replace });
      state = "outside";
    } else if (SEARCH_MARK.test(line)) {
      return `Block ${blocks.length + 1} ist unvollständig: >>>>>>> REPLACE fehlt.`;
    } else replace.push(line);
  }
  if (state !== "outside")
    return `Block ${blocks.length + 1} ist unvollständig: ${state === "search" ? "Trennzeile =======" : ">>>>>>> REPLACE"} fehlt.`;
  return blocks.length ? blocks : null;
}

function leading(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

function findMatches(lines: string[], search: string[], normalize: (line: string) => string) {
  const target = search.map(normalize);
  const source = lines.map(normalize);
  const matches: number[] = [];
  for (let start = 0; start + target.length <= source.length; start++) {
    let equal = true;
    for (let offset = 0; offset < target.length; offset++) {
      if (source[start + offset] !== target[offset]) {
        equal = false;
        break;
      }
    }
    if (equal) {
      matches.push(start);
      if (matches.length > 1) break;
    }
  }
  return matches;
}

function reindent(replace: string[], search: string[], matched: string[]): string[] {
  const from = leading(search.find((line) => line.trim()) ?? "");
  const to = leading(matched.find((line) => line.trim()) ?? "");
  if (from === to) return replace;
  return replace.map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith(from)) return to + line.slice(from.length);
    return to + line.trimStart();
  });
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

function preview(search: string[]): string {
  const line = (search.find((entry) => entry.trim()) ?? "").trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

function applyBlock(text: string, block: EditBlock, number: number): string | { error: string } {
  const search = block.search;
  const replace = block.replace;
  if (search.every((line) => !line.trim())) {
    const addition = replace.join("\n");
    if (!text.trim()) return addition;
    if (text.endsWith("\n")) return `${text}${addition}\n`;
    return `${text}\n${addition}`;
  }
  const lines = text.split("\n");
  const exact = findMatches(lines, search, (line) => line);
  if (exact.length === 1) {
    lines.splice(exact[0], search.length, ...replace);
    return lines.join("\n");
  }
  if (exact.length > 1)
    return {
      error: `SEARCH-Block ${number} ist mehrdeutig: "${preview(search)}" kommt mehrfach vor.`,
    };
  const ambiguous = {
    error: `SEARCH-Block ${number} ist mehrdeutig: "${preview(search)}" kommt mehrfach vor.`,
  };
  const trimmed = trimBlankEdges(search);
  const lineMatch = (normalize: (line: string) => string, indent: boolean) => {
    const matches = findMatches(lines, trimmed, normalize);
    if (matches.length !== 1) return matches.length > 1 ? ambiguous : null;
    const start = matches[0];
    const matched = lines.slice(start, start + trimmed.length);
    const cleaned = trimBlankEdges(replace);
    lines.splice(
      start,
      trimmed.length,
      ...(indent ? reindent(cleaned, trimmed, matched) : cleaned),
    );
    return lines.join("\n");
  };
  const loose = lineMatch((line) => line.trimEnd(), false);
  if (loose) return loose;
  const needle = search.join("\n");
  const first = text.indexOf(needle);
  if (first >= 0) {
    if (text.indexOf(needle, first + 1) >= 0) return ambiguous;
    return text.slice(0, first) + replace.join("\n") + text.slice(first + needle.length);
  }
  const indented = lineMatch((line) => line.trim(), true);
  if (indented) return indented;
  return { error: `SEARCH-Block ${number} wurde nicht gefunden: "${preview(search)}"` };
}

export function applyModelEdit(original: string, output: string): EditResult {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const base = eol === "\r\n" ? original.replace(/\r\n/g, "\n") : original;
  const parsed = parseBlocks(output);
  if (typeof parsed === "string") return { ok: false, error: parsed };
  if (parsed === null) {
    const full = stripFences(output);
    if (!full.trim()) return { ok: false, error: "Die Antwort enthält keinen Code." };
    const withNewline = base.endsWith("\n") && !full.endsWith("\n") ? `${full}\n` : full;
    return {
      ok: true,
      mode: "full",
      text: eol === "\n" ? withNewline : withNewline.replace(/\n/g, eol),
    };
  }
  let text = base;
  for (const [index, block] of parsed.entries()) {
    const next = applyBlock(text, block, index + 1);
    if (typeof next !== "string") return { ok: false, error: next.error };
    text = next;
  }
  return { ok: true, mode: "blocks", text: eol === "\n" ? text : text.replace(/\n/g, eol) };
}

import { splitSqlStatements } from "@/lib/sql-statements";

export interface EditTarget {
  start: number;
  end: number;
  mode: "selection" | "statement" | "generate" | "comment";
  instruction?: string;
}

function lineStartOf(text: string, offset: number): number {
  return offset > 0 ? text.lastIndexOf("\n", offset - 1) + 1 : 0;
}

export function expandToLines(text: string, start: number, end: number) {
  const from = lineStartOf(text, start);
  let to = end;
  if (to > from && text[to - 1] === "\n") to--;
  const lineEnd = text.indexOf("\n", to);
  return { start: from, end: lineEnd < 0 ? text.length : lineEnd };
}

export function statementBounds(text: string, offset: number, dialect?: string) {
  const { statements } = splitSqlStatements(text, dialect);
  let match = statements.find((statement) => offset >= statement.start && offset <= statement.end);
  if (!match) {
    const previous = statements.filter((statement) => statement.end <= offset).at(-1);
    if (previous && !text.slice(previous.end, offset).trim()) match = previous;
  }
  return match && match.text.trim() ? { start: match.start, end: match.end } : null;
}

function commentBlock(text: string, offset: number) {
  const lines = text.split("\n");
  let index = text.slice(0, offset).split("\n").length - 1;
  if (!/^\s*--/.test(lines[index] ?? "")) return null;
  let first = index;
  while (first > 0 && /^\s*--/.test(lines[first - 1])) first--;
  while (index + 1 < lines.length && /^\s*--/.test(lines[index + 1])) index++;
  const instruction = lines
    .slice(first, index + 1)
    .map((line) => line.replace(/^\s*--\s?/, ""))
    .join(" ")
    .trim();
  const end = lines.slice(0, index + 1).join("\n").length;
  return { end, instruction };
}

export function resolveTarget(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  dialect?: string,
): EditTarget {
  if (selectionEnd > selectionStart && text.slice(selectionStart, selectionEnd).trim())
    return { ...expandToLines(text, selectionStart, selectionEnd), mode: "selection" };
  const comment = commentBlock(text, selectionStart);
  if (comment) {
    const position = Math.min(text.length, comment.end + 1);
    return { start: position, end: position, mode: "comment", instruction: comment.instruction };
  }
  const lineStart = lineStartOf(text, selectionStart);
  const lineEndIndex = text.indexOf("\n", selectionStart);
  const line = text.slice(lineStart, lineEndIndex < 0 ? text.length : lineEndIndex);
  if (!line.trim()) return { start: lineStart, end: lineStart, mode: "generate" };
  const statement = statementBounds(text, selectionStart, dialect);
  if (statement)
    return { ...expandToLines(text, statement.start, statement.end), mode: "statement" };
  return { ...expandToLines(text, selectionStart, selectionStart), mode: "statement" };
}

export function insertionAfter(text: string, end: number): number {
  const lineEnd = text.indexOf("\n", end);
  return lineEnd < 0 ? text.length : lineEnd + 1;
}

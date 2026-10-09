export interface IdentifierSpan {
  start: number;
  end: number;
  word: string;
}

export interface RenameProposal {
  oldName: string;
  newName: string;
  ranges: { start: number; end: number }[];
}

const KEYWORDS = new Set(
  `select from where and or not null is in as on join left right inner outer full cross group by order having limit offset insert into values update set delete create alter drop table view index with union all distinct case when then else end between like ilike exists returning asc desc true false begin commit rollback`.split(
    " ",
  ),
);

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

export function identifierAt(text: string, offset: number): IdentifierSpan | null {
  let start = offset;
  while (start > 0 && IDENT_PART.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && IDENT_PART.test(text[end])) end++;
  if (start === end || !IDENT_START.test(text[start])) return null;
  return { start, end, word: text.slice(start, end) };
}

export function identifiers(text: string, from = 0, to = text.length): IdentifierSpan[] {
  const result: IdentifierSpan[] = [];
  let index = from;
  while (index < to) {
    const char = text[index];
    if (char === "'") {
      index++;
      while (index < to) {
        if (text[index] === "'" && text[index + 1] === "'") index += 2;
        else if (text[index] === "'") break;
        else index++;
      }
      index++;
    } else if (char === "-" && text[index + 1] === "-") {
      while (index < to && text[index] !== "\n") index++;
    } else if (char === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      index = close < 0 || close >= to ? to : close + 2;
    } else if (char === '"' || char === "`" || char === "[") {
      const closing = char === "[" ? "]" : char;
      const close = text.indexOf(closing, index + 1);
      const end = close < 0 || close >= to ? to : close;
      const word = text.slice(index + 1, end);
      if (word) result.push({ start: index + 1, end, word });
      index = end + 1;
    } else if (IDENT_START.test(char) && (index === 0 || !IDENT_PART.test(text[index - 1]))) {
      let end = index + 1;
      while (end < to && IDENT_PART.test(text[end])) end++;
      result.push({ start: index, end, word: text.slice(index, end) });
      index = end;
    } else index++;
  }
  return result;
}

export function isRenameCandidate(oldName: string, newName: string): boolean {
  return (
    oldName !== newName &&
    oldName.length > 0 &&
    newName.length > 0 &&
    IDENT_START.test(oldName[0]) &&
    IDENT_START.test(newName[0]) &&
    !KEYWORDS.has(oldName.toLowerCase()) &&
    !KEYWORDS.has(newName.toLowerCase()) &&
    oldName.toLowerCase() !== newName.toLowerCase()
  );
}

export function findRenameProposal(
  text: string,
  scope: { start: number; end: number },
  edited: { start: number; end: number },
  oldName: string,
  newName: string,
  limit = 50,
): RenameProposal | null {
  if (!isRenameCandidate(oldName, newName)) return null;
  const lower = oldName.toLowerCase();
  const ranges = identifiers(text, scope.start, scope.end)
    .filter(
      (span) =>
        span.word.toLowerCase() === lower && (span.end <= edited.start || span.start >= edited.end),
    )
    .slice(0, limit)
    .map(({ start, end }) => ({ start, end }));
  return ranges.length ? { oldName, newName, ranges } : null;
}

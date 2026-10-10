export interface SqlToken {
  text: string;
  kind: "keyword" | "string" | "number" | "plain";
}

const KEYWORDS = new Set(
  "select from where join left right inner outer full cross on and or not in is null as order by group having limit offset insert into values update set delete returning with union all distinct case when then else end like ilike between exists create alter drop table index view vacuum analyze copy begin commit rollback desc asc".split(
    " ",
  ),
);

const TOKEN = /('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([^'A-Za-z0-9_]+)/g;

export function tokenizeSqlLine(line: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  for (const match of line.matchAll(TOKEN)) {
    const [text, quoted, number, word] = match;
    if (quoted) tokens.push({ text, kind: "string" });
    else if (number) tokens.push({ text, kind: "number" });
    else if (word && KEYWORDS.has(word.toLowerCase())) tokens.push({ text, kind: "keyword" });
    else tokens.push({ text, kind: "plain" });
  }
  return tokens;
}

export interface AiMarkdownColumn {
  id: string;
  label: string;
  align: "left" | "center" | "right";
}
export type AiMarkdownBlock =
  | { type: "markdown"; id: string; text: string }
  | {
      type: "table";
      id: string;
      columns: AiMarkdownColumn[];
      rows: { id: string; cells: string[] }[];
    };

function pipeRow(line: string) {
  const text = line.trim();
  const cells: string[] = [];
  let cell = "";
  let firstDelimiter = -1;
  let lastDelimiter = -1;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\" && ["|", "\\"].includes(text[index + 1])) {
      cell += text[++index];
      continue;
    }
    if (character === "\\" && text[index + 1] === "`") {
      cell += text.slice(index, index + 2);
      index++;
      continue;
    }
    if (character === "`") {
      const span = text.slice(index).match(/^(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/);
      if (span) {
        cell += span[0];
        index += span[0].length - 1;
        continue;
      }
      let end = index + 1;
      while (text[end] === "`") end++;
      cell += text.slice(index, end);
      index = end - 1;
      continue;
    }
    if (character === "|") {
      if (firstDelimiter < 0) firstDelimiter = index;
      lastDelimiter = index;
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  if (firstDelimiter === 0) cells.shift();
  if (lastDelimiter === text.length - 1) cells.pop();
  return { cells, hasDelimiter: firstDelimiter >= 0 };
}

export function parseAiMarkdownTables(source: string): AiMarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: AiMarkdownBlock[] = [];
  let plain: string[] = [];
  let plainStart = 0;
  const flush = () => {
    if (plain.length)
      blocks.push({ type: "markdown", id: `text-${plainStart}`, text: plain.join("\n") });
    plain = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const header = pipeRow(lines[index]);
    const separator = pipeRow(lines[index + 1] ?? "");
    if (
      !header.hasDelimiter ||
      !header.cells.length ||
      header.cells.length !== separator.cells.length ||
      !separator.cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      if (!plain.length) plainStart = index;
      plain.push(lines[index]);
      continue;
    }
    flush();
    const start = index;
    const columns = header.cells.map((label, column) => ({
      id: `column-${column}`,
      label,
      align:
        separator.cells[column].startsWith(":") && separator.cells[column].endsWith(":")
          ? ("center" as const)
          : separator.cells[column].endsWith(":")
            ? ("right" as const)
            : ("left" as const),
    }));
    const rows: { id: string; cells: string[] }[] = [];
    index += 2;
    while (index < lines.length && lines[index].trim()) {
      const row = pipeRow(lines[index]);
      if (!row.hasDelimiter) break;
      rows.push({ id: `row-${index}`, cells: columns.map((_, column) => row.cells[column] ?? "") });
      index++;
    }
    blocks.push({ type: "table", id: `table-${start}`, columns, rows });
    index--;
  }
  flush();
  return blocks;
}

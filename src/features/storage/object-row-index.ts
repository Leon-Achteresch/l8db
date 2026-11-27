import type { BrowserRow } from "./use-object-listing";

export function indexObjectRows(rows: BrowserRow[]) {
  const positions = new Map<string, number>();
  let folderCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "folder") folderCount++;
    if (!positions.has(row.id)) positions.set(row.id, i);
  }
  return {
    folderCount,
    detail(id: string | null) {
      const index = id === null ? undefined : positions.get(id);
      const row = index === undefined ? undefined : rows[index];
      return row?.kind === "object" ? row : null;
    },
    selectedRows(selected: ReadonlySet<string>): BrowserRow[] {
      if (!selected.size) return [];
      if (selected.size > rows.length / 2 || positions.size !== rows.length) {
        return rows.filter((row) => selected.has(row.id));
      }
      const indices: number[] = [];
      for (const id of selected) {
        const index = positions.get(id);
        if (index !== undefined) indices.push(index);
      }
      return indices.sort((a, b) => a - b).map((index) => rows[index]);
    },
  };
}

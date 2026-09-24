export interface DefinitionHunk {
  sourceStart: number;
  sourceEnd: number;
  draftStart: number;
  draftEnd: number;
}

export function definitionHunks(source: string, draft: string): DefinitionHunk[] {
  const a = source.split("\n");
  const b = draft.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  if (start === aEnd && start === bEnd) return [];
  if ((aEnd - start) * (bEnd - start) > 300_000)
    return [{ sourceStart: start, sourceEnd: aEnd, draftStart: start, draftEnd: bEnd }];

  const width = bEnd - start + 1;
  const lengths = new Uint32Array((aEnd - start + 1) * width);
  for (let i = aEnd - start - 1; i >= 0; i--) {
    for (let j = bEnd - start - 1; j >= 0; j--) {
      const offset = i * width + j;
      lengths[offset] =
        a[start + i] === b[start + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[offset + 1]);
    }
  }

  const hunks: DefinitionHunk[] = [];
  let i = start;
  let j = start;
  let current: DefinitionHunk | null = null;
  const flush = () => {
    if (current) hunks.push(current);
    current = null;
  };
  while (i < aEnd || j < bEnd) {
    if (i < aEnd && j < bEnd && a[i] === b[j]) {
      flush();
      i++;
      j++;
      continue;
    }
    current ??= { sourceStart: i, sourceEnd: i, draftStart: j, draftEnd: j };
    if (
      i < aEnd &&
      (j === bEnd ||
        lengths[(i + 1 - start) * width + j - start] >=
          lengths[(i - start) * width + j + 1 - start])
    ) {
      i++;
      current.sourceEnd = i;
    } else {
      j++;
      current.draftEnd = j;
    }
  }
  flush();
  return hunks;
}

export function applyDefinitionHunk(source: string, draft: string, hunk: DefinitionHunk): string {
  const lines = draft.split("\n");
  lines.splice(
    hunk.draftStart,
    hunk.draftEnd - hunk.draftStart,
    ...source.split("\n").slice(hunk.sourceStart, hunk.sourceEnd),
  );
  return lines.join("\n");
}

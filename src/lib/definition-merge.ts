export interface DefinitionHunk {
  sourceStart: number;
  sourceEnd: number;
  draftStart: number;
  draftEnd: number;
}

const MAX_EDITS = 4_000;

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
  const n = aEnd - start;
  const m = bEnd - start;
  const maxEdits = Math.min(n + m, MAX_EDITS);
  const v = new Int32Array(2 * maxEdits + 3);
  const trace: Int32Array[] = [];
  const x0 = (k: number) => v[k + maxEdits + 1];
  for (let d = 0; d <= maxEdits; d++) {
    trace.push(v.slice(maxEdits + 1 - d, maxEdits + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && x0(k - 1) < x0(k + 1)) ? x0(k + 1) : x0(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[k + maxEdits + 1] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, start);
    }
  }
  return [{ sourceStart: start, sourceEnd: aEnd, draftStart: start, draftEnd: bEnd }];
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number): DefinitionHunk[] {
  const hunks: DefinitionHunk[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d];
    const at = (k: number) => v[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const insert = prevK === k + 1;
    const editX = insert ? prevX : prevX + 1;
    const editY = insert ? prevY + 1 : prevY;
    x = prevX;
    y = prevY;
    const last = hunks.at(-1);
    if (last && last.sourceStart === editX + offset && last.draftStart === editY + offset) {
      last.sourceStart = x + offset;
      last.draftStart = y + offset;
    } else {
      hunks.push({
        sourceStart: x + offset,
        sourceEnd: editX + offset,
        draftStart: y + offset,
        draftEnd: editY + offset,
      });
    }
  }
  return hunks.reverse();
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

export type DraftLineOrigin = "source" | "target" | "manual";

export function draftLineOrigins(
  sourceHunks: DefinitionHunk[],
  targetHunks: DefinitionHunk[],
  lineCount: number,
): (DraftLineOrigin | null)[] {
  const differs = (hunks: DefinitionHunk[]) => {
    const lines = new Array<boolean>(lineCount).fill(false);
    for (const hunk of hunks) lines.fill(true, hunk.draftStart, hunk.draftEnd);
    return lines;
  };
  const fromTarget = differs(sourceHunks);
  return differs(targetHunks).map((fromSource, line) =>
    fromSource && fromTarget[line]
      ? "manual"
      : fromSource
        ? "source"
        : fromTarget[line]
          ? "target"
          : null,
  );
}

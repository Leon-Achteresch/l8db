export interface DiffHunk {
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function lineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function encode(a: string[], b: string[]): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const map = (lines: string[]) => {
    const out = new Int32Array(lines.length);
    for (let index = 0; index < lines.length; index++) {
      let id = ids.get(lines[index]);
      if (id === undefined) {
        id = ids.size;
        ids.set(lines[index], id);
      }
      out[index] = id;
    }
    return out;
  };
  return [map(a), map(b)];
}

type Op = 0 | 1 | 2;

function myers(a: Int32Array, b: Int32Array): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const snapshot = trace[d];
    const at = (k: number) => snapshot[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(0);
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push(2);
      y--;
    } else {
      ops.push(1);
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push(0);
    x--;
    y--;
  }
  return ops.reverse();
}

export function diffLines(a: string, b: string, options: { maxCells?: number } = {}): DiffHunk[] {
  if (a === b) return [];
  const maxCells = options.maxCells ?? 4_000_000;
  const left = splitLines(a);
  const right = splitLines(b);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++;
  const oldMiddle = left.slice(prefix, left.length - suffix);
  const newMiddle = right.slice(prefix, right.length - suffix);
  if (oldMiddle.length === 0 && newMiddle.length === 0) return [];
  if (
    oldMiddle.length === 0 ||
    newMiddle.length === 0 ||
    oldMiddle.length * newMiddle.length > maxCells
  ) {
    return [
      { oldStart: prefix + 1, oldLines: oldMiddle, newStart: prefix + 1, newLines: newMiddle },
    ];
  }
  const [encodedA, encodedB] = encode(oldMiddle, newMiddle);
  const ops = myers(encodedA, encodedB);
  const hunks: DiffHunk[] = [];
  let x = 0;
  let y = 0;
  let current: DiffHunk | null = null;
  for (const op of ops) {
    if (op === 0) {
      current = null;
      x++;
      y++;
      continue;
    }
    if (!current) {
      current = { oldStart: prefix + x + 1, oldLines: [], newStart: prefix + y + 1, newLines: [] };
      hunks.push(current);
    }
    if (op === 1) {
      current.oldLines.push(oldMiddle[x]);
      x++;
    } else {
      current.newLines.push(newMiddle[y]);
      y++;
    }
  }
  return hunks;
}

export function applyHunks(
  original: string,
  hunks: DiffHunk[],
  accepted: readonly boolean[],
): string {
  const eol = lineEnding(original);
  const lines = splitLines(original);
  const order = hunks
    .map((hunk, index) => ({ hunk, index }))
    .sort((left, right) => left.hunk.oldStart - right.hunk.oldStart || left.index - right.index);
  const out: string[] = [];
  let cursor = 0;
  for (const { hunk, index } of order) {
    const start = Math.max(cursor, Math.min(lines.length, hunk.oldStart - 1));
    for (let line = cursor; line < start; line++) out.push(lines[line]);
    const end = Math.min(lines.length, start + hunk.oldLines.length);
    if (accepted[index]) out.push(...hunk.newLines);
    else for (let line = start; line < end; line++) out.push(lines[line]);
    cursor = end;
  }
  for (let line = cursor; line < lines.length; line++) out.push(lines[line]);
  return out.join(eol);
}

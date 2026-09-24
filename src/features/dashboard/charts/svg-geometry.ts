export type Point = [number, number];

export function niceTicks(min: number, max: number, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (
    let v = Math.floor(min / step) * step;
    v <= Math.ceil(max / step) * step + step / 2;
    v += step
  )
    ticks.push(Math.round(v / step) * step);
  return ticks;
}

export function scale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (value: number) => r0 + (value - d0) * k;
}

function monotoneTangents(points: Point[]) {
  const n = points.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    slopes.push(dx === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx);
  }
  const tangents = [slopes[0]];
  for (let i = 1; i < n - 1; i++) {
    const d0 = points[i][0] - points[i - 1][0];
    const d1 = points[i + 1][0] - points[i][0];
    const s0 = slopes[i - 1];
    const s1 = slopes[i];
    tangents.push(s0 * s1 <= 0 ? 0 : (3 * (d0 + d1)) / ((2 * d1 + d0) / s0 + (d1 + 2 * d0) / s1));
  }
  tangents.push(slopes[n - 2]);
  return tangents;
}

export function curvePath(points: Point[], curve: "monotone" | "linear", move = true) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const start = `${move ? "M" : "L"}${first[0]},${first[1]}`;
  if (curve === "linear" || points.length < 3)
    return start + rest.map(([x, y]) => `L${x},${y}`).join("");
  const t = monotoneTangents(points);
  let d = start;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    d += `C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

export function polar(cx: number, cy: number, r: number, angle: number): Point {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

export function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const sweep = Math.min(to - from, Math.PI * 2 - 1e-4);
  if (sweep <= 0) return "";
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, from + sweep);
  return `M${x0},${y0}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
}

export type Tile<T> = { item: T; x: number; y: number; width: number; height: number };

export function squarify<T extends { value: number }>(
  items: T[],
  x: number,
  y: number,
  width: number,
  height: number,
): Tile<T>[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const area = (width * height) / total;
  const tiles: Tile<T>[] = [];
  const queue = [...items].sort((a, b) => b.value - a.value);
  let box = { x, y, width, height };
  const worst = (row: T[], side: number) => {
    const sum = row.reduce((s, item) => s + item.value * area, 0);
    const max = Math.max(...row.map((item) => item.value * area));
    const min = Math.min(...row.map((item) => item.value * area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  while (queue.length) {
    const side = Math.min(box.width, box.height);
    const row = [queue.shift() as T];
    while (queue.length && worst([...row, queue[0]], side) <= worst(row, side))
      row.push(queue.shift() as T);
    const sum = row.reduce((s, item) => s + item.value * area, 0);
    const thickness = sum / side;
    let offset = 0;
    for (const item of row) {
      const length = (item.value * area) / thickness;
      tiles.push(
        box.width >= box.height
          ? { item, x: box.x, y: box.y + offset, width: thickness, height: length }
          : { item, x: box.x + offset, y: box.y, width: length, height: thickness },
      );
      offset += length;
    }
    box =
      box.width >= box.height
        ? { x: box.x + thickness, y: box.y, width: box.width - thickness, height: box.height }
        : { x: box.x, y: box.y + thickness, width: box.width, height: box.height - thickness };
  }
  return tiles;
}

export function labelStep(band: number, longest: number) {
  return Math.max(1, Math.ceil((longest * 6.5 + 16) / Math.max(band, 1)));
}

export type Box = { left: number; top: number; right: number; bottom: number };

export function stackValues(data: Record<string, unknown>[], keys: string[], stacked: boolean) {
  const base = data.map(() => [0, 0]);
  return keys.map((key) =>
    data.map((row, i) => {
      const value = Number(row[key]) || 0;
      if (!stacked) return [0, value] as Point;
      const slot = value >= 0 ? 0 : 1;
      const low = base[i][slot];
      base[i][slot] += value;
      return [low, low + value] as Point;
    }),
  );
}

export function valueDomain(stacks: Point[][]): [number, number] {
  let min = 0;
  let max = 0;
  for (const series of stacks)
    for (const [low, high] of series) {
      min = Math.min(min, low, high);
      max = Math.max(max, low, high);
    }
  const ticks = niceTicks(min, max);
  return [ticks[0], ticks[ticks.length - 1]];
}

export function sectorPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number,
) {
  const sweep = Math.min(to - from, Math.PI * 2 - 1e-4);
  if (sweep <= 0 || outer <= 0) return "";
  const large = sweep > Math.PI ? 1 : 0;
  const [ox0, oy0] = polar(cx, cy, outer, from);
  const [ox1, oy1] = polar(cx, cy, outer, from + sweep);
  const [ix1, iy1] = polar(cx, cy, inner, from + sweep);
  const [ix0, iy0] = polar(cx, cy, inner, from);
  return `M${ox0},${oy0}A${outer},${outer} 0 ${large} 1 ${ox1},${oy1}L${ix1},${iy1}A${inner},${inner} 0 ${large} 0 ${ix0},${iy0}Z`;
}

export function roundArcPath(
  cx: number,
  cy: number,
  r: number,
  width: number,
  from: number,
  to: number,
) {
  const cap = r > 0 ? width / 2 / r : 0;
  const start = from + cap;
  const end = to - cap;
  if (end <= start) {
    const [x, y] = polar(cx, cy, r, (from + to) / 2);
    return `M${x},${y}L${x},${y}`;
  }
  return arcPath(cx, cy, r, start, end);
}

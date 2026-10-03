export interface ErPoint {
  x: number;
  y: number;
}

export interface ErObstacle extends ErPoint {
  width: number;
  height: number;
}

export function segmentHitsObstacle(
  from: ErPoint,
  to: ErPoint,
  obstacle: ErObstacle,
  padding = 8,
): boolean {
  if (from.y === to.y)
    return (
      from.y > obstacle.y - padding &&
      from.y < obstacle.y + obstacle.height + padding &&
      Math.max(from.x, to.x) > obstacle.x - padding &&
      Math.min(from.x, to.x) < obstacle.x + obstacle.width + padding
    );
  return (
    from.x > obstacle.x - padding &&
    from.x < obstacle.x + obstacle.width + padding &&
    Math.max(from.y, to.y) > obstacle.y - padding &&
    Math.min(from.y, to.y) < obstacle.y + obstacle.height + padding
  );
}

function simplify(points: ErPoint[]): ErPoint[] {
  const result: ErPoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    const before = result.at(-2);
    if (previous?.x === point.x && previous.y === point.y) continue;
    if (
      before &&
      previous &&
      ((before.x === previous.x && previous.x === point.x) ||
        (before.y === previous.y && previous.y === point.y))
    )
      result.pop();
    result.push(point);
  }
  return result;
}

export function routeRelationship(
  source: ErPoint,
  target: ErPoint,
  obstacles: ErObstacle[],
  previousRoutes: ErPoint[][] = [],
): ErPoint[] | null {
  const start = { x: source.x + 24, y: source.y };
  const end = { x: target.x - 24, y: target.y };
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...obstacles.flatMap((rect) => [rect.x - 24, rect.x + rect.width + 24]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...obstacles.flatMap((rect) => [rect.y - 24, rect.y + rect.height + 24]),
    ]),
  ].sort((a, b) => a - b);
  const startCell = ys.indexOf(start.y) * xs.length + xs.indexOf(start.x);
  const endCell = ys.indexOf(end.y) * xs.length + xs.indexOf(end.x);
  const pointOf = (cell: number): ErPoint => ({
    x: xs[cell % xs.length],
    y: ys[Math.floor(cell / xs.length)],
  });
  const heap: { state: number; cost: number; priority: number }[] = [];
  const push = (entry: (typeof heap)[number]) => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].priority <= entry.priority) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = entry;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop();
    if (!last || heap.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child++;
      if (heap[child].priority >= last.priority) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return first;
  };
  const costs = new Map<number, number>([[startCell * 2, 0]]);
  const parents = new Map<number, number>();
  const clearSegments = new Map<string, boolean>();
  push({ state: startCell * 2, cost: 0, priority: 0 });
  while (heap.length > 0) {
    const current = pop();
    if (!current || current.cost !== costs.get(current.state)) continue;
    const cell = Math.floor(current.state / 2);
    if (cell === endCell) {
      const points = [target, end];
      let state: number | undefined = current.state;
      while (state !== undefined) {
        points.push(pointOf(Math.floor(state / 2)));
        state = parents.get(state);
      }
      points.push(source);
      return simplify(points.reverse());
    }
    const from = pointOf(cell);
    const x = cell % xs.length;
    const y = Math.floor(cell / xs.length);
    const neighbors = [
      ...(x > 0 ? [{ cell: cell - 1, direction: 0 }] : []),
      ...(x + 1 < xs.length ? [{ cell: cell + 1, direction: 0 }] : []),
      ...(y > 0 ? [{ cell: cell - xs.length, direction: 1 }] : []),
      ...(y + 1 < ys.length ? [{ cell: cell + xs.length, direction: 1 }] : []),
    ];
    for (const neighbor of neighbors) {
      const to = pointOf(neighbor.cell);
      const segment =
        cell < neighbor.cell ? `${cell}:${neighbor.cell}` : `${neighbor.cell}:${cell}`;
      let clear = clearSegments.get(segment);
      if (clear === undefined) {
        clear = !obstacles.some((obstacle) => segmentHitsObstacle(from, to, obstacle));
        clearSegments.set(segment, clear);
      }
      if (!clear) continue;
      let crossings = 0;
      for (const route of previousRoutes) {
        for (let index = 1; index < route.length; index++) {
          const a = route[index - 1];
          const b = route[index];
          if (
            from.y === to.y &&
            a.x === b.x &&
            a.x > Math.min(from.x, to.x) &&
            a.x < Math.max(from.x, to.x) &&
            from.y > Math.min(a.y, b.y) &&
            from.y < Math.max(a.y, b.y)
          )
            crossings++;
          if (
            from.x === to.x &&
            a.y === b.y &&
            a.y > Math.min(from.y, to.y) &&
            a.y < Math.max(from.y, to.y) &&
            from.x > Math.min(a.x, b.x) &&
            from.x < Math.max(a.x, b.x)
          )
            crossings++;
        }
      }
      const cost =
        current.cost +
        Math.abs(from.x - to.x) +
        Math.abs(from.y - to.y) +
        (current.state % 2 !== neighbor.direction ? 24 : 0) +
        crossings * 400;
      const next = neighbor.cell * 2 + neighbor.direction;
      if (cost >= (costs.get(next) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(next, cost);
      parents.set(next, current.state);
      push({ state: next, cost, priority: cost + Math.abs(to.x - end.x) + Math.abs(to.y - end.y) });
    }
  }
  return null;
}

export function relationshipPath(points: ErPoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
}

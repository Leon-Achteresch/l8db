export interface MapTile<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function layoutTiles<T>(items: T[], weight: (item: T) => number): MapTile<T>[] {
  const weighted = items
    .map((item) => ({ item, weight: Math.max(Number.EPSILON, weight(item)) }))
    .sort((a, b) => b.weight - a.weight);
  const tiles: MapTile<T>[] = [];
  const split = (group: typeof weighted, x: number, y: number, w: number, h: number) => {
    if (group.length === 0) return;
    if (group.length === 1) {
      tiles.push({ item: group[0].item, x, y, w, h });
      return;
    }
    const total = group.reduce((sum, entry) => sum + entry.weight, 0);
    let index = 0;
    let first = 0;
    while (index < group.length - 1 && first + group[index].weight <= total / 2) {
      first += group[index].weight;
      index++;
    }
    if (index === 0) {
      first = group[0].weight;
      index = 1;
    }
    const share = first / total;
    if (w >= h) {
      split(group.slice(0, index), x, y, w * share, h);
      split(group.slice(index), x + w * share, y, w * (1 - share), h);
    } else {
      split(group.slice(0, index), x, y, w, h * share);
      split(group.slice(index), x, y + h * share, w, h * (1 - share));
    }
  };
  split(weighted, 0, 0, 1, 1);
  return tiles;
}

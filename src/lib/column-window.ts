import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";

export function columnWindowRange(
  range: Range,
  pinned: number[],
  before = range.overscan,
  after = range.overscan,
): number[] {
  const visible =
    before === range.overscan && after === range.overscan
      ? defaultRangeExtractor(range)
      : Array.from(
          {
            length:
              Math.min(range.count - 1, range.endIndex + after) -
              Math.max(0, range.startIndex - before) +
              1,
          },
          (_, index) => Math.max(0, range.startIndex - before) + index,
        );
  return [...new Set([...pinned, ...visible])].sort((a, b) => a - b);
}

export function assignColumnSlots(
  visible: number[],
  previous: ReadonlyMap<number, number>,
): Map<number, number> {
  const slots = new Map<number, number>();
  const used = new Set<number>();
  for (const index of visible) {
    const slot = previous.get(index);
    if (slot === undefined) continue;
    slots.set(index, slot);
    used.add(slot);
  }
  let free = 0;
  for (const index of visible) {
    if (slots.has(index)) continue;
    while (used.has(free)) free++;
    slots.set(index, free);
    used.add(free);
  }
  return slots;
}

export function gridColumnTemplate(widths: number[]): string {
  return widths.map((width) => `minmax(${width}px, ${width}fr)`).join(" ");
}

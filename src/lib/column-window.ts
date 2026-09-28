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

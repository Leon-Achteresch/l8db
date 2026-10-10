import type { Range } from "@tanstack/react-virtual";

export function createGridWindowRange(
  before: number,
  after: number,
  blockSize: number,
  pinned: readonly number[] = [],
) {
  let previousStart = -1;
  let previousEnd = -1;
  let previousCount = -1;
  let previous: number[] = [];
  return (range: Range) => {
    const first = Math.max(0, Math.floor((range.startIndex - before) / blockSize) * blockSize);
    const size =
      Math.ceil(
        (range.endIndex - range.startIndex + 1 + before + after + blockSize - 1) / blockSize,
      ) * blockSize;
    const last = Math.min(range.count - 1, first + size - 1);
    if (
      range.count === previousCount &&
      ((first === previousStart && last === previousEnd) ||
        (previousStart <= Math.max(0, range.startIndex - before) &&
          previousEnd >= Math.min(range.count - 1, range.endIndex + after) &&
          previousEnd - previousStart + 1 <= size + blockSize))
    )
      return previous;
    previousStart = first;
    previousEnd = last;
    previousCount = range.count;
    const visible = Array.from(
      { length: Math.max(0, last - first + 1) },
      (_, index) => first + index,
    );
    if (pinned.length === 0) {
      previous = visible;
      return previous;
    }
    previous = [
      ...new Set([...pinned.filter((index) => index >= 0 && index < range.count), ...visible]),
    ].sort((left, right) => left - right);
    return previous;
  };
}

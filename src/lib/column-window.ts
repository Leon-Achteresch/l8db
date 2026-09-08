import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";

export function columnWindowRange(range: Range, pinned: number[]): number[] {
  const batchSize = 4;
  const batchedRange = {
    ...range,
    startIndex: Math.floor(range.startIndex / batchSize) * batchSize,
    endIndex: Math.min(
      range.count - 1,
      Math.ceil((range.endIndex + 1) / batchSize) * batchSize - 1,
    ),
  };
  return [...new Set([...pinned, ...defaultRangeExtractor(batchedRange)])].sort((a, b) => a - b);
}

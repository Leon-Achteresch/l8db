import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";

export function columnWindowRange(range: Range, pinned: number[]): number[] {
  return [...new Set([...pinned, ...defaultRangeExtractor(range)])].sort((a, b) => a - b);
}

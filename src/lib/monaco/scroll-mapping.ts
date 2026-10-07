export interface ScrollLineMapping {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
}

export function projectScrollLine(
  mappings: readonly ScrollLineMapping[],
  line: number,
  reverse = false,
): ScrollLineMapping {
  let offset = 0;
  for (const mapping of mappings) {
    const sourceStart = (reverse ? mapping.targetStart : mapping.sourceStart) + 1;
    const sourceEnd = (reverse ? mapping.targetEnd : mapping.sourceEnd) + 1;
    const targetStart = (reverse ? mapping.sourceStart : mapping.targetStart) + 1;
    const targetEnd = (reverse ? mapping.sourceEnd : mapping.targetEnd) + 1;
    if (line < sourceStart) break;
    if (line < sourceEnd) return { sourceStart, sourceEnd, targetStart, targetEnd };
    offset = targetEnd - sourceEnd;
  }
  return {
    sourceStart: line,
    sourceEnd: line + 1,
    targetStart: line + offset,
    targetEnd: line + offset + 1,
  };
}

export function interpolateScrollTop(
  scrollTop: number,
  sourceStart: number,
  sourceEnd: number,
  targetStart: number,
  targetEnd: number,
): number {
  if (scrollTop === 0) return 0;
  const height = sourceEnd - sourceStart;
  const progress = height > 0 ? Math.min(Math.max((scrollTop - sourceStart) / height, 0), 1) : 0;
  return targetStart + (targetEnd - targetStart) * progress;
}

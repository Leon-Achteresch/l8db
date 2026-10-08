export interface ScrollLineMapping {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
}

export interface ScrollLineRange extends ScrollLineMapping {
  targetStartGap: boolean;
  targetEndGap: boolean;
}

function lineBlocks(mappings: readonly ScrollLineMapping[], reverse: boolean): ScrollLineMapping[] {
  return mappings.map((mapping) => ({
    sourceStart: (reverse ? mapping.targetStart : mapping.sourceStart) + 1,
    sourceEnd: (reverse ? mapping.targetEnd : mapping.sourceEnd) + 1,
    targetStart: (reverse ? mapping.sourceStart : mapping.targetStart) + 1,
    targetEnd: (reverse ? mapping.sourceEnd : mapping.targetEnd) + 1,
  }));
}

function lineOffset(blocks: readonly ScrollLineMapping[], line: number): number {
  let offset = 0;
  for (const block of blocks) {
    if (block.sourceEnd > line) break;
    offset = block.targetEnd - block.sourceEnd;
  }
  return offset;
}

export function projectScrollLine(
  mappings: readonly ScrollLineMapping[],
  line: number,
  reverse = false,
): ScrollLineRange {
  const blocks = lineBlocks(mappings, reverse);
  const block = blocks.find((item) => line >= item.sourceStart && line < item.sourceEnd);
  if (block)
    return { ...block, targetStartGap: block.targetStart === block.targetEnd, targetEndGap: false };
  const next = blocks.find(
    (item) => item.sourceStart === line + 1 && item.sourceEnd > item.sourceStart,
  );
  return {
    sourceStart: line,
    sourceEnd: line + 1,
    targetStart: line + lineOffset(blocks, line),
    targetEnd: next ? next.targetStart : line + 1 + lineOffset(blocks, line + 1),
    targetStartGap: false,
    targetEndGap: next ? next.targetStart === next.targetEnd : false,
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

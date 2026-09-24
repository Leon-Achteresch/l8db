export interface MergeConflict {
  start: number;
  end: number;
  current: string;
  base: string;
  incoming: string;
}

const conflictPattern =
  /^<<<<<<< [^\r\n]*\r?\n([\s\S]*?)^\|\|\|\|\|\|\| [^\r\n]*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> [^\r\n]*(?:\r?\n|$)/gm;
const markerPattern = /^(?:<<<<<<< |\|\|\|\|\|\|\| |=======\r?$|>>>>>>> )/m;

export function hasMergeMarkers(content: string): boolean {
  return markerPattern.test(content);
}

export function mergeConflicts(content: string): MergeConflict[] {
  return [...content.matchAll(conflictPattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    current: match[1],
    base: match[2],
    incoming: match[3],
  }));
}

export function resolveMergeConflict(
  content: string,
  conflict: MergeConflict,
  choice: "current" | "incoming",
): string {
  return `${content.slice(0, conflict.start)}${conflict[choice]}${content.slice(conflict.end)}`;
}

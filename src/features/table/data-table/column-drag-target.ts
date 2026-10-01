export function columnDragTarget(
  widths: number[],
  groups: string[],
  from: number,
  center: number,
  scrollLeft: number,
): number {
  let start = 0;
  const middles = widths.map((width, index) => {
    const middle = start + width / 2 - (groups[index] === "center" ? scrollLeft : 0);
    start += width;
    return middle;
  });
  let to = from;
  while (to + 1 < widths.length && groups[to + 1] === groups[from] && center > middles[to + 1])
    to++;
  if (to !== from) return to;
  while (to > 0 && groups[to - 1] === groups[from] && center < middles[to - 1]) to--;
  return to;
}

function isWordStart(text: string, index: number) {
  if (index === 0) return true;
  const previous = text[index - 1];
  return (
    !/[a-z0-9]/i.test(previous) ||
    (previous === previous.toLowerCase() && text[index] !== text[index].toLowerCase())
  );
}

export function mayMatchWord(candidate: string, word: string): boolean {
  if (!word) return true;
  const text = candidate.toLowerCase();
  const pattern = word.toLowerCase();
  let position = -1;
  for (
    let start = text.indexOf(pattern[0]);
    start !== -1;
    start = text.indexOf(pattern[0], start + 1)
  ) {
    if (isWordStart(candidate, start)) {
      position = start;
      break;
    }
  }
  if (position === -1) return false;
  for (let i = 1; i < pattern.length; i++) {
    position = text.indexOf(pattern[i], position + 1);
    if (position === -1) return false;
  }
  return true;
}

export function limitMatches<T extends { label: string; filterText?: string }>(
  items: T[],
  word: string,
  limit: number,
): { items: T[]; truncated: boolean } {
  const cap = Math.max(0, limit);
  if (!word) return { items: items.slice(0, cap), truncated: items.length > cap };
  const prefix = word.toLowerCase();
  const matching: T[] = [];
  const prefixMatches: T[] = [];
  const otherMatches: T[] = [];
  let count = 0;
  for (const item of items) {
    const candidate = item.filterText ?? item.label;
    if (!mayMatchWord(candidate, word)) continue;
    count++;
    if (matching.length < cap) matching.push(item);
    const bucket = candidate.toLowerCase().startsWith(prefix) ? prefixMatches : otherMatches;
    if (bucket.length < cap) bucket.push(item);
  }
  if (count <= cap) return { items: matching, truncated: false };
  return {
    items: [...prefixMatches, ...otherMatches].slice(0, cap),
    truncated: true,
  };
}

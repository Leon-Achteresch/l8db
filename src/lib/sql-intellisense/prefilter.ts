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
  const matching = items.filter((item) => mayMatchWord(item.filterText ?? item.label, word));
  if (matching.length <= limit) return { items: matching, truncated: false };
  const prefix = word.toLowerCase();
  const startsWith = (item: T) =>
    (item.filterText ?? item.label).toLowerCase().startsWith(prefix) ? 0 : 1;
  return {
    items: matching
      .map((item, index) => ({ item, index, rank: startsWith(item) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, limit)
      .map((entry) => entry.item),
    truncated: true,
  };
}

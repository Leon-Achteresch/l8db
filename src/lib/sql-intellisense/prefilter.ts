function isWordStart(text: string, index: number) {
  if (index === 0) return true;
  const previous = text[index - 1];
  return (
    !/[a-z0-9]/i.test(previous) ||
    (previous === previous.toLowerCase() && text[index] !== text[index].toLowerCase())
  );
}

export function mayMatchWord(candidate: string, word: string): boolean {
  return matchesLower(candidate, candidate.toLowerCase(), word.toLowerCase());
}

const lowered = new WeakMap<object, string>();

function lowerCandidate(item: { label: string; filterText?: string }): string {
  let text = lowered.get(item);
  if (text === undefined) {
    text = (item.filterText ?? item.label).toLowerCase();
    lowered.set(item, text);
  }
  return text;
}

function matchesLower(candidate: string, text: string, pattern: string): boolean {
  if (!pattern) return true;
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
    const text = lowerCandidate(item);
    if (!matchesLower(candidate, text, prefix)) continue;
    count++;
    if (matching.length < cap) matching.push(item);
    const bucket = text.startsWith(prefix) ? prefixMatches : otherMatches;
    if (bucket.length < cap) bucket.push(item);
  }
  if (count <= cap) return { items: matching, truncated: false };
  return {
    items: [...prefixMatches, ...otherMatches].slice(0, cap),
    truncated: true,
  };
}

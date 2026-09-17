function fuzzyMatch(needle: string, hay: string) {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

function textScore(needle: string, hay: string) {
  if (!hay) return 0;
  hay = hay.toLowerCase();
  if (hay === needle) return 1000;
  if (hay.startsWith(needle)) return 800;
  const index = hay.indexOf(needle);
  if (index > 0) return /[^a-z0-9]/.test(hay[index - 1]) ? 600 - index : 400 - index;
  return fuzzyMatch(needle, hay) ? 100 : 0;
}

export function commandScore(
  query: string,
  item: { label: string; group?: string; keywords?: string[] },
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  const rest = [item.group ?? "", ...(item.keywords ?? [])];
  const score = (part: string) =>
    Math.max(textScore(part, item.label), ...rest.map((h) => textScore(part, h) / 2));
  const tokens = needle.split(/\s+/).map(score);
  const perToken = tokens.includes(0) ? 0 : tokens.reduce((a, b) => a + b, 0) / tokens.length;
  return Math.max(score(needle), perToken);
}

export function rankCommands<T extends { label: string; group?: string; keywords?: string[] }>(
  items: T[],
  query: string,
) {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: commandScore(query, item) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length)
    .map((r) => r.item);
}

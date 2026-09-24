type Scorable = { label: string; group?: string; keywords?: string[] };

function fuzzyMatch(needle: string, hay: string) {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

function isWordChar(code: number) {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function textScore(needle: string, hay: string) {
  if (!hay) return 0;
  if (hay === needle) return 1000;
  const index = hay.indexOf(needle);
  if (index === 0) return 800;
  if (index > 0) return isWordChar(hay.charCodeAt(index - 1)) ? 400 - index : 600 - index;
  return fuzzyMatch(needle, hay) ? 100 : 0;
}

const lowered = new WeakMap<Scorable, { label: string; rest: string[]; all: string }>();

function haystacks(item: Scorable) {
  let entry = lowered.get(item);
  if (!entry) {
    const label = item.label.toLowerCase();
    const rest = [item.group ?? "", ...(item.keywords ?? [])].map((h) => h.toLowerCase());
    entry = { label, rest, all: [label, ...rest].join(" ") };
    lowered.set(item, entry);
  }
  return entry;
}

function partScore(part: string, label: string, rest: string[]) {
  let best = textScore(part, label);
  if (best >= 1000) return best;
  for (const hay of rest) {
    const score = textScore(part, hay) / 2;
    if (score > best) best = score;
  }
  return best;
}

export function scoreNeedle(needle: string, item: Scorable) {
  const { label, rest, all } = haystacks(item);
  const tokens = needle.split(/\s+/);
  for (const token of tokens) if (!fuzzyMatch(token, all)) return 0;
  const whole = partScore(needle, label, rest);
  if (tokens.length === 1) return whole;
  let sum = 0;
  for (const token of tokens) {
    const score = partScore(token, label, rest);
    if (score === 0) return whole;
    sum += score;
  }
  return Math.max(whole, sum / tokens.length);
}

export function commandScore(query: string, item: Scorable) {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  return scoreNeedle(needle, item);
}

export function rankCommands<T extends Scorable>(items: T[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = scoreNeedle(needle, item);
    if (score > 0) scored.push({ item, score });
  }
  return sortScored(scored);
}

export function sortScored<T extends Scorable>(scored: { item: T; score: number }[]) {
  return scored
    .sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length)
    .map((r) => r.item);
}

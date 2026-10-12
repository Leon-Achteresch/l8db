type Scorable = { label: string; group?: string; hint?: string; keywords?: string[] };

function matchPositions(needle: string, hay: string): number[] | null {
  const index = hay.indexOf(needle);
  if (index >= 0) return Array.from({ length: needle.length }, (_, i) => index + i);
  let best: number[] | null = null;
  let start = 0;
  while (start < hay.length) {
    let end = start;
    let matched = 0;
    for (; end < hay.length && matched < needle.length; end++) {
      if (hay[end] === needle[matched]) matched++;
    }
    if (matched < needle.length) break;
    const positions = new Array<number>(needle.length);
    matched = needle.length - 1;
    for (let i = end - 1; matched >= 0; i--) {
      if (hay[i] === needle[matched]) positions[matched--] = i;
    }
    if (!best || fuzzyScore(positions, hay) > fuzzyScore(best, hay)) best = positions;
    start = positions[0] + 1;
  }
  return best;
}

function isWordChar(code: number) {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function fuzzyScore(positions: number[], hay: string) {
  const span = positions[positions.length - 1] - positions[0] + 1;
  const boundary = positions[0] === 0 || !isWordChar(hay.charCodeAt(positions[0] - 1));
  return 100 + (positions.length / span) * 50 + (boundary ? 25 : 0);
}

function textScore(needle: string, hay: string) {
  if (!hay) return 0;
  if (hay === needle) return 1000;
  const index = hay.indexOf(needle);
  if (index === 0) return 800;
  if (index > 0) return isWordChar(hay.charCodeAt(index - 1)) ? 400 - index : 600 - index;
  const positions = matchPositions(needle, hay);
  return positions ? fuzzyScore(positions, hay) : 0;
}

const lowered = new WeakMap<Scorable, { label: string; rest: string[] }>();

function haystacks(item: Scorable) {
  let entry = lowered.get(item);
  if (!entry) {
    const label = item.label.toLowerCase();
    const rest = [item.group ?? "", item.hint ?? "", ...(item.keywords ?? [])].map((h) =>
      h.toLowerCase(),
    );
    entry = { label, rest };
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
  if (!needle) return 1;
  const { label, rest } = haystacks(item);
  const tokens = needle.split(/\s+/);
  const whole = partScore(needle, label, rest);
  if (tokens.length === 1) return whole;
  let sum = 0;
  for (const token of tokens) {
    const score = partScore(token, label, rest);
    if (score === 0) return 0;
    sum += score;
  }
  return Math.max(whole, sum / tokens.length);
}

export function commandMatchRanges(query: string, text: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hay = text.toLowerCase();
  const offsets: { start: number; end: number }[] = [];
  if (hay.length !== text.length) {
    let start = 0;
    for (const character of text) {
      const end = start + character.length;
      for (let i = 0; i < character.toLowerCase().length; i++) offsets.push({ start, end });
      start = end;
    }
  }
  const matched = new Set<number>();
  for (const token of needle.split(/\s+/)) {
    const positions = matchPositions(token, hay);
    if (!positions) continue;
    for (const position of positions) {
      const offset = offsets[position];
      if (offset) {
        for (let i = offset.start; i < offset.end; i++) matched.add(i);
      } else matched.add(position);
    }
  }
  const ranges: { start: number; end: number }[] = [];
  for (const position of [...matched].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && last.end === position) last.end++;
    else ranges.push({ start: position, end: position + 1 });
  }
  return ranges;
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

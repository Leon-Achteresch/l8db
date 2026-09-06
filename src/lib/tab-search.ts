export interface TabSearchSource {
  id: string;
  title: string;
  sql: string;
}

export interface TabSearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  maxMatches?: number;
}

export interface TabSearchMatch {
  tabId: string;
  tabTitle: string;
  line: number;
  column: number;
  length: number;
  lineText: string;
  preview: string;
  previewStart: number;
  previewLength: number;
}

export interface TabSearchResult {
  matches: TabSearchMatch[];
  invalidPattern: boolean;
  truncated: boolean;
}

const PREVIEW_RADIUS = 48;
const DEFAULT_MAX_MATCHES = 500;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(query: string, options: TabSearchOptions): RegExp | null {
  const source = options.regex ? query : escapeRegExp(query);
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
  const flags = options.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(wrapped, flags);
  } catch {
    return null;
  }
}

function buildPreview(
  lineText: string,
  column: number,
  length: number,
): { preview: string; previewStart: number; previewLength: number } {
  const matchStart = column - 1;
  const from = Math.max(0, matchStart - PREVIEW_RADIUS);
  const to = Math.min(lineText.length, matchStart + length + PREVIEW_RADIUS);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < lineText.length ? "…" : "";
  return {
    preview: `${prefix}${lineText.slice(from, to)}${suffix}`,
    previewStart: prefix.length + (matchStart - from),
    previewLength: length,
  };
}

export function searchQueryTabs(
  sources: TabSearchSource[],
  query: string,
  options: TabSearchOptions = {},
): TabSearchResult {
  const trimmed = query.trim();
  if (!trimmed) return { matches: [], invalidPattern: false, truncated: false };

  const pattern = buildPattern(query, options);
  if (!pattern) return { matches: [], invalidPattern: true, truncated: false };

  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const matches: TabSearchMatch[] = [];
  let truncated = false;

  for (const source of sources) {
    const lines = source.sql.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index].replace(/\r$/, "");
      pattern.lastIndex = 0;
      let hit: RegExpExecArray | null;
      while ((hit = pattern.exec(lineText)) !== null) {
        if (matches.length >= maxMatches) {
          return { matches, invalidPattern: false, truncated: true };
        }
        const length = hit[0].length;
        const column = hit.index + 1;
        matches.push({
          tabId: source.id,
          tabTitle: source.title,
          line: index + 1,
          column,
          length,
          lineText,
          ...buildPreview(lineText, column, length),
        });
        if (length === 0) pattern.lastIndex += 1;
      }
    }
  }

  return { matches, invalidPattern: false, truncated };
}

export function groupMatchesByTab(matches: TabSearchMatch[]): {
  tabId: string;
  tabTitle: string;
  matches: TabSearchMatch[];
}[] {
  const groups: { tabId: string; tabTitle: string; matches: TabSearchMatch[] }[] = [];
  for (const match of matches) {
    const existing = groups.find((group) => group.tabId === match.tabId);
    if (existing) existing.matches.push(match);
    else groups.push({ tabId: match.tabId, tabTitle: match.tabTitle, matches: [match] });
  }
  return groups;
}

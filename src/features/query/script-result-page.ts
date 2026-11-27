import type { ScriptRunEntry } from "./script-result-list";

const PAGE_SIZE = 50;

export function scriptPageForEntry(entries: ScriptRunEntry[], index: number | null) {
  if (index === null) return 0;
  const position = entries.findIndex((entry) => entry.index === index);
  return Math.floor(Math.max(0, position) / PAGE_SIZE);
}

export function scriptResultPage(entries: ScriptRunEntry[], page: number, issuesOnly: boolean) {
  let done = 0;
  let failed = 0;
  let warned = 0;
  for (const entry of entries) {
    if (entry.status === "success") done++;
    else if (entry.status === "error") failed++;
    else if (entry.status === "warning") warned++;
  }

  const count = issuesOnly ? failed + warned : entries.length;
  const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, count);
  const visible: ScriptRunEntry[] = [];
  if (issuesOnly && count > 0) {
    let matched = 0;
    for (const entry of entries) {
      if (entry.status !== "error" && entry.status !== "warning") continue;
      if (matched >= start) visible.push(entry);
      if (++matched === end) break;
    }
  }

  return {
    done,
    failed,
    warned,
    count,
    currentPage,
    lastPage,
    start,
    end,
    visible: issuesOnly ? visible : entries.slice(start, end),
  };
}

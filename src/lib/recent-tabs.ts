const history: string[] = [];

export function noteActiveTab(key: string) {
  const at = history.indexOf(key);
  if (at !== -1) history.splice(at, 1);
  history.unshift(key);
  history.length = Math.min(history.length, 50);
}

export function recentTabKeys(): readonly string[] {
  return history;
}

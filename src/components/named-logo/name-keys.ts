export function candidateKeys(name: string): string[] {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!base) return [];
  const keys = [base];
  for (const suffix of ["database", "db"]) {
    if (base.endsWith(suffix) && base.length > suffix.length + 1) {
      keys.push(base.slice(0, -suffix.length));
    }
  }
  return keys;
}

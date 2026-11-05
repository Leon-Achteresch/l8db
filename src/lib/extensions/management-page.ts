export const EXTENSIONS_PAGE_SIZE = 25;
export function extensionPage<T, U>(full: readonly T[], light: readonly U[], requested: number) {
  const total = full.length + light.length;
  const page = Math.min(
    Math.max(0, requested),
    Math.max(0, Math.ceil(total / EXTENSIONS_PAGE_SIZE) - 1),
  );
  const start = page * EXTENSIONS_PAGE_SIZE;
  return {
    page,
    total,
    full: full.slice(start, start + EXTENSIONS_PAGE_SIZE),
    light: light.slice(
      Math.max(0, start - full.length),
      Math.max(0, start + EXTENSIONS_PAGE_SIZE - full.length),
    ),
  };
}

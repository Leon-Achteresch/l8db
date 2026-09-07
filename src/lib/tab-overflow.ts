export function clippedTabKeys(
  tabs: readonly { key: string; left: number; width: number }[],
  scrollLeft: number,
  viewportWidth: number,
): string[] {
  return tabs
    .filter(
      (tab) => tab.left < scrollLeft - 1 || tab.left + tab.width > scrollLeft + viewportWidth + 1,
    )
    .map((tab) => tab.key);
}

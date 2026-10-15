export function afterPaint(run: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(run, 0);
    return;
  }
  requestAnimationFrame(() => setTimeout(run, 0));
}

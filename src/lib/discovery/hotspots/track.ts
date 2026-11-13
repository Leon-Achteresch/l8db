import type { FeatureEntry } from "../types";
import { selectHotspot } from "./model";

export const RESCAN_DELAY_MS = 250;

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function trackAnchor(
  element: Element,
  onRect: (rect: AnchorRect | null) => void,
): () => void {
  let frame = 0;
  let visible = true;
  const measure = () => {
    frame = 0;
    if (!visible || !element.isConnected) {
      onRect(null);
      return;
    }
    const { top, left, width, height } = element.getBoundingClientRect();
    onRect(width > 0 && height > 0 ? { top, left, width, height } : null);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(element);
  resize.observe(document.documentElement);
  const intersection = new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last) visible = last.isIntersecting;
    schedule();
  });
  intersection.observe(element);
  const options = { capture: true, passive: true };
  window.addEventListener("scroll", schedule, options);
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    resize.disconnect();
    intersection.disconnect();
    window.removeEventListener("scroll", schedule, options);
    window.removeEventListener("resize", schedule);
  };
}

export function watchHotspot<T extends Element>(
  candidates: readonly FeatureEntry[],
  find: (entry: FeatureEntry) => T | null,
  onTarget: (target: { entry: FeatureEntry; element: T } | null) => void,
  root: Node = document.body,
): () => void {
  if (!candidates.length) {
    onTarget(null);
    return () => undefined;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: { entry: FeatureEntry; element: T } | null | undefined;
  const pick = () => {
    timer = undefined;
    if (current?.element.isConnected && find(current.entry) === current.element) return;
    const next = selectHotspot(candidates, find);
    if (
      current !== undefined &&
      next?.element === current?.element &&
      next?.entry === current?.entry
    )
      return;
    current = next;
    onTarget(next);
  };
  const observer = new MutationObserver(() => {
    if (timer === undefined) timer = setTimeout(pick, RESCAN_DELAY_MS);
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-feature", "hidden", "data-state", "aria-hidden"],
  });
  pick();
  return () => {
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  };
}

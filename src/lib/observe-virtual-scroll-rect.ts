import type { Rect, Virtualizer } from "@tanstack/react-virtual";

export function observeVirtualScrollRect<TScroll extends Element, TItem extends Element>(
  instance: Virtualizer<TScroll, TItem>,
  callback: (rect: Rect) => void,
) {
  const element = instance.scrollElement;
  const targetWindow = instance.targetWindow;
  if (!element || !targetWindow?.ResizeObserver) return;
  let frame: number | undefined;
  let lastWidth = -1;
  let lastHeight = -1;
  let disposed = false;
  const observer = new targetWindow.ResizeObserver(([entry]) => {
    if (!entry || disposed) return;
    const box = entry.borderBoxSize[0];
    const width = Math.round(box?.inlineSize ?? entry.contentRect.width);
    const height = Math.round(box?.blockSize ?? entry.contentRect.height);
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    const update = () => {
      frame = undefined;
      if (!disposed) callback({ width, height });
    };
    if (instance.options.useAnimationFrameWithResizeObserver) {
      if (frame !== undefined) targetWindow.cancelAnimationFrame(frame);
      frame = targetWindow.requestAnimationFrame(update);
    } else {
      update();
    }
  });
  observer.observe(element, { box: "border-box" });
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) targetWindow.cancelAnimationFrame(frame);
  };
}

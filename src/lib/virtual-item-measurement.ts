import type { Virtualizer } from "@tanstack/react-virtual";

export function measureVirtualItem<TScroll extends Element, TItem extends Element>(
  element: TItem,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<TScroll, TItem>,
) {
  const box = entry?.borderBoxSize[0];
  if (box) return Math.round(instance.options.horizontal ? box.inlineSize : box.blockSize);
  const index = instance.indexFromElement(element);
  return (
    instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
    instance.options.estimateSize(index)
  );
}

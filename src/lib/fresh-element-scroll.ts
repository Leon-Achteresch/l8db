import { elementScroll, type Virtualizer } from "@tanstack/react-virtual";

export function createFreshElementScroll<TScroll extends Element, TItem extends Element>() {
  const initialized = new WeakSet<TScroll>();
  return (
    offset: number,
    options: { adjustments?: number; behavior?: ScrollBehavior },
    instance: Virtualizer<TScroll, TItem>,
  ) => {
    const element = instance.scrollElement;
    if (!element) return;
    if (!initialized.has(element)) {
      initialized.add(element);
      if (offset + (options.adjustments ?? 0) === 0 && options.behavior !== "smooth") return;
    }
    elementScroll(offset, options, instance);
  };
}

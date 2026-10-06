import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { SidebarMenu } from "@/components/ui/sidebar";

export function SidebarMeasuredWindow({
  count,
  estimateSize,
  getItemKey,
  className,
  children,
}: {
  count: number;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => string;
  className?: string;
  children: (index: number) => ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [layout, setLayout] = useState<{
    scroller: HTMLElement | null;
    margin: number;
    gap: number;
  }>({ scroller: null, margin: 0, gap: 0 });

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>("[data-slot=sidebar-content]");
    if (!list || !scroller) return;
    const measure = () => {
      const margin =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
      setLayout((previous) =>
        previous.scroller === scroller && previous.margin === margin && previous.gap === gap
          ? previous
          : { scroller, margin, gap },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    scroller.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", measure);
    };
  }, []);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => layout.scroller,
    estimateSize,
    getItemKey,
    gap: layout.gap,
    scrollMargin: layout.margin,
    overscan: 6,
    initialRect: { width: 0, height: 900 },
    useFlushSync: false,
  });
  const items = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    items.forEach((item, position) => {
      const element = list.children[position] as HTMLElement | undefined;
      if (!element) return;
      element.dataset.index = String(item.index);
      virtualizer.measureElement(element);
    });
  });

  const first = items[0];
  const last = items[items.length - 1];
  return (
    <SidebarMenu
      ref={listRef}
      className={className}
      style={{
        paddingTop: first ? first.start - layout.margin : 0,
        paddingBottom: last
          ? Math.max(0, virtualizer.getTotalSize() - (last.end - layout.margin))
          : 0,
      }}
    >
      {items.map((item) => children(item.index))}
    </SidebarMenu>
  );
}

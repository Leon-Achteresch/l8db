import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SidebarMenu } from "@/components/ui/sidebar";

const OVERSCAN = 10;
const MIN_COUNT = 60;
const ESTIMATED_PITCH = 36;

export function SidebarWindow({
  count,
  disabled,
  className,
  children,
}: {
  count: number;
  disabled?: boolean;
  className?: string;
  children: (index: number) => ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const pitchRef = useRef(ESTIMATED_PITCH);
  const windowed = !disabled && count > MIN_COUNT;
  const [range, setRange] = useState({ start: 0, end: count });

  const update = useCallback(() => {
    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>("[data-slot=sidebar-content]");
    if (!list || !scroller) return;
    const first = list.firstElementChild;
    const second = first?.nextElementSibling;
    if (first && second) {
      const pitch = second.getBoundingClientRect().top - first.getBoundingClientRect().top;
      if (pitch > 0) pitchRef.current = pitch;
    }
    const pitch = pitchRef.current;
    const offset = scroller.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const start = Math.max(0, Math.floor(offset / pitch) - OVERSCAN);
    const end = Math.min(count, Math.ceil((offset + scroller.clientHeight) / pitch) + OVERSCAN);
    setRange((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
  }, [count]);

  useEffect(() => {
    if (!windowed) {
      setRange((previous) =>
        previous.start === 0 && previous.end === count ? previous : { start: 0, end: count },
      );
      return;
    }
    const scroller = listRef.current?.closest<HTMLElement>("[data-slot=sidebar-content]");
    if (!scroller) return;
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [windowed, count, update]);

  useEffect(() => {
    if (windowed) update();
  });

  const start = windowed ? Math.min(range.start, count) : 0;
  const end = windowed ? Math.min(range.end, count) : count;
  const items: ReactNode[] = [];
  for (let index = start; index < end; index++) items.push(children(index));

  return (
    <SidebarMenu
      ref={listRef}
      className={className}
      style={
        windowed
          ? {
              paddingTop: start * pitchRef.current,
              paddingBottom: (count - end) * pitchRef.current,
            }
          : undefined
      }
    >
      {items}
    </SidebarMenu>
  );
}

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SidebarMenu } from "@/components/ui/sidebar";

const OVERSCAN = 26;
const EDGE_MARGIN = 2;
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
  const frameRef = useRef(0);
  const windowed = !disabled && count > MIN_COUNT;
  const [range, setRange] = useState({
    start: 0,
    end: Math.min(count, MIN_COUNT),
    pitch: ESTIMATED_PITCH,
  });

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
    const visibleStart = Math.max(0, Math.floor(offset / pitch));
    const visibleEnd = Math.min(count, Math.ceil((offset + scroller.clientHeight) / pitch));
    const start = Math.min(
      Math.max(0, count - Math.ceil(scroller.clientHeight / pitch)),
      Math.max(0, visibleStart - OVERSCAN),
    );
    const end = Math.min(count, Math.max(start + 1, visibleEnd + OVERSCAN));
    setRange((previous) => {
      if (
        previous.pitch === pitch &&
        (previous.start === 0 || visibleStart - previous.start >= EDGE_MARGIN) &&
        (previous.end === count || previous.end - visibleEnd >= EDGE_MARGIN)
      )
        return previous;
      if (previous.start === start && previous.end === end && previous.pitch === pitch)
        return previous;
      return { start, end, pitch };
    });
  }, [count]);

  useEffect(() => {
    if (!windowed) {
      setRange((previous) =>
        previous.start === 0 && previous.end === count
          ? previous
          : { ...previous, start: 0, end: count },
      );
      return;
    }
    const scroller = listRef.current?.closest<HTMLElement>("[data-slot=sidebar-content]");
    if (!scroller) return;
    const schedule = () => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        update();
      });
    };
    schedule();
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    if (listRef.current) observer.observe(listRef.current);
    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [windowed, count, update]);

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

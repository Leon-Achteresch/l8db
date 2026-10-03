import { type RefObject, useEffect, useRef } from "react";
import { animatePageWave } from "../page-wave";

export function usePageFlip(
  scrollRef: RefObject<HTMLDivElement | null>,
  page: number,
  hasNextPage: boolean,
  onPageChange: ((page: number) => void) | undefined,
) {
  const lastWheelRef = useRef(0);

  const waveRefs = { down: useRef<SVGSVGElement>(null), up: useRef<SVGSVGElement>(null) };
  const prevPageRef = useRef(page);
  useEffect(() => {
    const direction = Math.sign(page - prevPageRef.current);
    prevPageRef.current = page;
    const element = direction > 0 ? waveRefs.down.current : waveRefs.up.current;
    if (!direction || !element) return;
    animatePageWave(element);
  }, [page, waveRefs.down, waveRefs.up]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !onPageChange) return;
    const handleWheel = (event: WheelEvent) => {
      const newGesture = event.timeStamp - lastWheelRef.current > 300;
      lastWheelRef.current = event.timeStamp;
      if (!newGesture || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const atTop = element.scrollTop <= 0;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      const down = event.deltaY > 0;
      if (down && atBottom && hasNextPage) onPageChange(page + 1);
      else if (!down && atTop && page > 0) onPageChange(page - 1);
    };
    element.addEventListener("wheel", handleWheel, { passive: true });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [onPageChange, page, hasNextPage]);
  return waveRefs;
}

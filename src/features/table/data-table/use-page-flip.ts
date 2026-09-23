import { useDebouncedCallback } from "@tanstack/react-pacer";
import { type RefObject, useEffect, useRef } from "react";
import { animatePageWave } from "../page-wave";

export function usePageFlip(
  scrollRef: RefObject<HTMLDivElement | null>,
  page: number,
  hasNextPage: boolean,
  onPageChange: ((page: number) => void) | undefined,
) {
  const armedRef = useRef(false);
  const armPageFlip = useDebouncedCallback(
    () => {
      armedRef.current = true;
    },
    { wait: 400 },
  );

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
      const atTop = element.scrollTop <= 0;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      const down = event.deltaY > 0;
      if (!((down && atBottom) || (!down && atTop))) {
        armedRef.current = false;
        return;
      }
      if (!armedRef.current) {
        armPageFlip();
        return;
      }
      armedRef.current = false;
      if (down && hasNextPage) onPageChange(page + 1);
      else if (!down && page > 0) onPageChange(page - 1);
    };
    element.addEventListener("wheel", handleWheel, { passive: true });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [onPageChange, page, hasNextPage, armPageFlip]);
  return waveRefs;
}

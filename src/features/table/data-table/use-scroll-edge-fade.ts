import { type RefObject, useEffect } from "react";

export function useScrollEdgeFade(
  scrollRef: RefObject<HTMLElement | null>,
  fadeRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const scroller = scrollRef.current;
    const fade = fadeRef.current;
    if (!scroller || !fade) return;
    const update = () => {
      const more = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
      fade.style.opacity = more ? "1" : "0";
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef, fadeRef]);
}

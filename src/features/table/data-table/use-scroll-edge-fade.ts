import { type RefObject, useEffect } from "react";

export function attachScrollEdgeFade(scroller: HTMLElement, fade: HTMLElement): () => void {
  let shown = "";
  let top = "";
  const edge = () => {
    const next = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 ? "1" : "0";
    if (next !== shown) fade.style.opacity = shown = next;
  };
  const measure = () => {
    const head = scroller.querySelector("thead");
    const next = `${head ? head.offsetHeight : 0}px`;
    if (next !== top) fade.style.top = top = next;
    edge();
  };
  measure();
  scroller.addEventListener("scroll", edge, { passive: true });
  const observer = new ResizeObserver(measure);
  observer.observe(scroller);
  if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
  return () => {
    scroller.removeEventListener("scroll", edge);
    observer.disconnect();
  };
}

export function useScrollEdgeFade(
  scrollRef: RefObject<HTMLElement | null>,
  fadeRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const scroller = scrollRef.current;
    const fade = fadeRef.current;
    if (!scroller || !fade) return;
    return attachScrollEdgeFade(scroller, fade);
  }, [scrollRef, fadeRef]);
}

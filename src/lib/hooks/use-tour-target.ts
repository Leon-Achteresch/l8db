import { useEffect, useState } from "react";
import { visibleElement } from "@/lib/tour/conditions";
import type { Rect } from "@/lib/tour/placement";

export const TOUR_TARGET_POLL_MS = 400;

function same(previous: Rect | null, next: DOMRect) {
  return (
    previous !== null &&
    Math.abs(previous.left - next.left) < 0.5 &&
    Math.abs(previous.top - next.top) < 0.5 &&
    Math.abs(previous.width - next.width) < 0.5 &&
    Math.abs(previous.height - next.height) < 0.5
  );
}

export function useTourTarget(selector: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let element: HTMLElement | null = null;
    let frame = 0;
    const resize =
      typeof ResizeObserver === "function" ? new ResizeObserver(() => schedule()) : null;
    let scrolled = false;
    const find = () => {
      const next = visibleElement(selector);
      if (next === element) return;
      if (element) resize?.unobserve(element);
      element = next;
      if (!element) return;
      resize?.observe(element);
      if (scrolled) return;
      scrolled = true;
      element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    const measure = () => {
      frame = 0;
      if (!element?.isConnected) find();
      let box = element?.getBoundingClientRect();
      if (box && box.width === 0 && box.height === 0) {
        find();
        box = element?.getBoundingClientRect();
      }
      if (!box || (box.width === 0 && box.height === 0)) {
        setRect(null);
        return;
      }
      const next = box;
      setRect((previous) =>
        same(previous, next)
          ? previous
          : { left: next.left, top: next.top, width: next.width, height: next.height },
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    const timer = window.setInterval(() => {
      if (!document.hidden) schedule();
    }, TOUR_TARGET_POLL_MS);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [selector]);

  return rect;
}

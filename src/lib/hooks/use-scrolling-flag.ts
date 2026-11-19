import { type RefObject, useEffect } from "react";

const IDLE_MS = 140;

export function trackScrolling(element: HTMLElement, release: EventTarget = window) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let pressed = false;
  const end = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!active) return;
    active = false;
    element.removeAttribute("data-scrolling");
  };
  const onScroll = () => {
    if (pressed) return;
    if (!active) {
      active = true;
      element.setAttribute("data-scrolling", "");
    }
    clearTimeout(timer);
    timer = setTimeout(end, IDLE_MS);
  };
  const onPress = () => {
    pressed = true;
    end();
  };
  const onRelease = () => {
    pressed = false;
  };
  element.addEventListener("scroll", onScroll, { passive: true });
  element.addEventListener("pointerdown", onPress, { capture: true, passive: true });
  release.addEventListener("pointerup", onRelease, { passive: true });
  release.addEventListener("pointercancel", onRelease, { passive: true });
  return () => {
    end();
    element.removeEventListener("scroll", onScroll);
    element.removeEventListener("pointerdown", onPress, { capture: true });
    release.removeEventListener("pointerup", onRelease);
    release.removeEventListener("pointercancel", onRelease);
  };
}

export function useScrollingFlag(scrollRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = scrollRef.current;
    if (element) return trackScrolling(element);
  }, [scrollRef]);
}

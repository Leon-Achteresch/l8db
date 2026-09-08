import { useLayoutEffect, useRef, useState } from "react";
import { clippedTabKeys } from "@/lib/tab-overflow";

function revealTabElement(nav: HTMLElement, track: HTMLElement, key: string | undefined) {
  const el = Array.from(track.querySelectorAll<HTMLElement>("[data-tab-key]")).find(
    (element) => element.dataset.tabKey === key,
  );
  if (!el) return;
  if (el.offsetLeft < nav.scrollLeft) nav.scrollLeft = el.offsetLeft;
  else if (el.offsetLeft + el.offsetWidth > nav.scrollLeft + nav.clientWidth) {
    nav.scrollLeft = el.offsetLeft + el.offsetWidth - nav.clientWidth;
  }
}

export function useTabOverflow(activeKey: string | undefined, tabs: readonly unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const nav = navRef.current;
    const track = trackRef.current;
    if (!container || !nav || !track) return;

    const elements = () => Array.from(track.querySelectorAll<HTMLElement>("[data-tab-key]"));
    const measure = () => {
      setOverflow(track.offsetWidth > container.clientWidth + 1);
      const hidden = clippedTabKeys(
        elements().map((el) => ({
          key: el.dataset.tabKey!,
          left: el.offsetLeft,
          width: el.offsetWidth,
        })),
        nav.scrollLeft,
        nav.clientWidth,
      );
      setHiddenKeys((previous) =>
        previous.length === hidden.length && previous.every((key, index) => key === hidden[index])
          ? previous
          : hidden,
      );
    };
    const revealActive = () => {
      revealTabElement(nav, track, activeKey);
      measure();
    };

    const observer = new ResizeObserver(revealActive);
    observer.observe(container);
    observer.observe(nav);
    observer.observe(track);
    for (const el of elements()) observer.observe(el);
    nav.addEventListener("scroll", measure, { passive: true });
    revealActive();
    return () => {
      observer.disconnect();
      nav.removeEventListener("scroll", measure);
    };
  }, [activeKey, tabs]);

  const revealTab = (key: string) => {
    if (navRef.current && trackRef.current) revealTabElement(navRef.current, trackRef.current, key);
  };

  return { containerRef, navRef, trackRef, overflow, hiddenKeys, revealTab };
}

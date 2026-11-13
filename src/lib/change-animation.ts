import { EASE_OUT_CSS } from "@/lib/ease";

export type ChangeAnimation = "view" | "section";

const active = new WeakMap<HTMLElement, () => void>();

export function animateChange(element: HTMLElement, kind: ChangeAnimation = "view", direction = 1) {
  active.get(element)?.();
  if (typeof element.animate !== "function" || document.visibilityState === "hidden")
    return () => undefined;

  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = preference.matches;
  const animations: Animation[] = [];
  const add = (target: HTMLElement, frames: Keyframe[], duration: number, delay = 0) => {
    animations.push(
      target.animate(frames, { duration, delay, fill: "backwards", easing: EASE_OUT_CSS }),
    );
  };
  add(
    element,
    reduced
      ? [{ opacity: 0.8 }, { opacity: 1 }]
      : kind === "section"
        ? [{ opacity: 0.9 }, { opacity: 1 }]
        : [
            { opacity: 0.88, transform: `translateX(${24 * direction}px) scale(0.992)` },
            { opacity: 1, transform: `translateX(${-direction}px) scale(1.001)`, offset: 0.8 },
            { opacity: 1, transform: "none" },
          ],
    reduced ? 100 : 420,
  );

  if (!reduced && kind === "section") {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    let visited = 0;
    let target = walker.nextNode();
    while (target && visited++ < 256 && animations.length < 7) {
      if (target instanceof HTMLElement && target.hasAttribute("data-setting-id")) {
        add(
          target,
          [
            { opacity: 0.5, transform: `translateX(${28 * direction}px)` },
            { opacity: 1, transform: "none" },
          ],
          380,
          (animations.length - 1) * 28,
        );
      }
      target = walker.nextNode();
    }
  }

  const stop = () => {
    for (const animation of animations) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
    preference.removeEventListener("change", stop);
    if (active.get(element) === stop) active.delete(element);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") stop();
  };

  let pending = animations.length;
  for (const animation of animations) {
    animation.onfinish = () => {
      if (--pending === 0) stop();
    };
    animation.oncancel = stop;
  }
  document.addEventListener("visibilitychange", onVisibilityChange);
  preference.addEventListener("change", stop);
  active.set(element, stop);
  return stop;
}

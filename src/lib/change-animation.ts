import { EASE_OUT_CSS } from "@/lib/ease";

export type ChangeAnimation = "view" | "section";

const active = new WeakMap<HTMLElement, () => void>();

export function animateChange(element: HTMLElement, kind: ChangeAnimation = "view") {
  active.get(element)?.();
  if (typeof element.animate !== "function" || document.visibilityState === "hidden")
    return () => undefined;

  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = preference.matches;
  const animation = element.animate(
    reduced
      ? [{ opacity: 0.8 }, { opacity: 1 }]
      : [
          { opacity: 0.65, transform: `translateY(${kind === "view" ? 8 : 4}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ],
    { duration: reduced ? 100 : kind === "view" ? 240 : 180, easing: EASE_OUT_CSS },
  );

  const stop = () => {
    animation.onfinish = null;
    animation.oncancel = null;
    animation.cancel();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    preference.removeEventListener("change", stop);
    if (active.get(element) === stop) active.delete(element);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") stop();
  };

  animation.onfinish = stop;
  animation.oncancel = stop;
  document.addEventListener("visibilitychange", onVisibilityChange);
  preference.addEventListener("change", stop);
  active.set(element, stop);
  return stop;
}

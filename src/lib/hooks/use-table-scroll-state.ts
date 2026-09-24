import { type RefObject, useLayoutEffect } from "react";
import { useTableViewStateStore } from "@/lib/table-view-state";

export function useTableScrollState(
  ref: RefObject<HTMLDivElement | null>,
  key: string | undefined,
  identity: string,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !key) return;
    const saved = useTableViewStateStore.getState().views[key]?.scroll;
    const position = {
      top: saved?.identity === identity ? saved.top : 0,
      left: saved?.left ?? 0,
    };
    let restoring = true;
    let frame = 0;
    const restore = () => {
      element.scrollTop = position.top;
      element.scrollLeft = position.left;
    };
    const last = { ...position };
    const track = () => {
      if (restoring) return;
      last.top = element.scrollTop;
      last.left = element.scrollLeft;
    };
    restore();
    // ponytail: retry a few frames because columns/rows virtualize in late and clamp scrollLeft to 0
    let attempts = 20;
    const tick = () => {
      restore();
      attempts -= 1;
      const done =
        attempts <= 0 ||
        (Math.abs(element.scrollLeft - position.left) < 1 &&
          Math.abs(element.scrollTop - position.top) < 1);
      if (done) {
        restoring = false;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    element.addEventListener("scroll", track, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", track);
      useTableViewStateStore.getState().patch(key, { scroll: { ...last, identity } });
    };
  }, [ref, key, identity]);
}

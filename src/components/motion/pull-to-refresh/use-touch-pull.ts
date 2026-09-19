import { type MutableRefObject, type RefObject, useEffect } from "react";
import { EMPTY_GESTURE, type Gesture } from "./types";

export function useTouchPull({
  rootRef,
  gestureRef,
  disabledRef,
  refreshingRef,
  finishPull,
  updatePull,
}: {
  rootRef: RefObject<HTMLElement | null>;
  gestureRef: MutableRefObject<Gesture>;
  disabledRef: MutableRefObject<boolean>;
  refreshingRef: MutableRefObject<boolean>;
  finishPull: () => void;
  updatePull: (distance: number) => void;
}) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        root.scrollTop > 0 ||
        disabledRef.current ||
        refreshingRef.current
      ) {
        return;
      }

      const touch = event.touches[0];
      gestureRef.current = {
        active: true,
        startX: touch.clientX,
        startY: touch.clientY,
        pointerId: null,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      const touch = event.touches[0];
      if (!gesture.active || !touch) return;

      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;

      if (root.scrollTop > 0 || deltaY < 0) {
        gestureRef.current = { ...EMPTY_GESTURE };
        return;
      }

      if (Math.abs(deltaX) > deltaY) return;

      event.preventDefault();
      updatePull(deltaY);
    };

    const onTouchEnd = () => {
      if (gestureRef.current.active) finishPull();
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);

    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [rootRef, gestureRef, disabledRef, refreshingRef, finishPull, updatePull]);
}

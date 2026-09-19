"use client";
// beui.dev/components/motion/pull-to-refresh

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SPRING_PANEL } from "@/lib/ease";
import { capturePointer, TOUCH_GESTURE_CONTENT_CLASS } from "@/lib/touch";
import { cn } from "@/lib/utils";
import { LABEL_SWAP, resistedDistance } from "./pull-to-refresh/constants";
import { RefreshBuddy } from "./pull-to-refresh/refresh-buddy";
import {
  EMPTY_GESTURE,
  type Gesture,
  type PullToRefreshProps,
  type PullToRefreshStatus,
} from "./pull-to-refresh/types";
import { useTouchPull } from "./pull-to-refresh/use-touch-pull";

export type { PullToRefreshProps, PullToRefreshStatus } from "./pull-to-refresh/types";

export function PullToRefresh({
  onRefresh,
  children,
  refreshing = false,
  disabled = false,
  threshold = 76,
  maxPull = 132,
  holdDistance = 68,
  pullingLabel = "Pull to refresh",
  releaseLabel = "Release to refresh",
  refreshingLabel = "Refreshing",
  ariaLabel = "Refreshable content",
  className,
  contentClassName,
  indicatorClassName,
}: PullToRefreshProps) {
  const rootRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<Gesture>({ ...EMPTY_GESTURE });
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const statusRef = useRef<PullToRefreshStatus>("idle");
  const disabledRef = useRef(disabled);
  const externalRefreshingRef = useRef(refreshing);
  const refreshingRef = useRef(refreshing);
  const [status, setStatusState] = useState<PullToRefreshStatus>("idle");
  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const reduce = useReducedMotion();
  const pullThreshold = Math.max(24, threshold);
  const pullLimit = Math.max(maxPull, pullThreshold + 24);
  const restingDistance = Math.min(Math.max(0, holdDistance), pullThreshold);
  const y = useMotionValue(0);
  const progress = useTransform(y, [0, pullThreshold], [0, 1]);
  const indicatorOpacity = useTransform(y, [0, 10, pullThreshold], [0, 0.45, 1]);
  const indicatorScale = useTransform(y, [0, pullThreshold], [0.86, 1]);
  const isRefreshing = refreshing || internalRefreshing;

  disabledRef.current = disabled;
  externalRefreshingRef.current = refreshing;
  refreshingRef.current = isRefreshing;

  const setStatus = useCallback((next: PullToRefreshStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const settle = useCallback(
    (target: number) => {
      animationRef.current?.stop();

      if (reduce) {
        y.set(target);
        return;
      }

      animationRef.current = animate(y, target, SPRING_PANEL);
    },
    [reduce, y],
  );

  const updatePull = useCallback(
    (distance: number) => {
      if (disabledRef.current || refreshingRef.current) return;
      animationRef.current?.stop();

      const next = resistedDistance(distance, pullLimit);
      y.set(next);
      setStatus(next >= pullThreshold ? "ready" : "pulling");
    },
    [pullLimit, pullThreshold, setStatus, y],
  );

  const runRefresh = useCallback(async () => {
    if (disabledRef.current || refreshingRef.current) return;

    setInternalRefreshing(true);
    setStatus("refreshing");
    settle(restingDistance);

    try {
      await onRefresh();
    } finally {
      setInternalRefreshing(false);

      // A synchronous refresh can resolve before React commits the temporary
      // internal state, so release here instead of relying only on the effect.
      if (!externalRefreshingRef.current) {
        setStatus("idle");
        settle(0);
      }
    }
  }, [onRefresh, restingDistance, setStatus, settle]);

  const finishPull = useCallback(() => {
    const shouldRefresh =
      y.get() >= pullThreshold && !disabledRef.current && !refreshingRef.current;

    gestureRef.current = { ...EMPTY_GESTURE };

    if (shouldRefresh) {
      void runRefresh();
      return;
    }

    setStatus("idle");
    settle(0);
  }, [pullThreshold, runRefresh, setStatus, settle, y]);

  useEffect(() => {
    if (isRefreshing) {
      setStatus("refreshing");
      settle(restingDistance);
      return;
    }

    if (statusRef.current === "refreshing") {
      setStatus("idle");
      settle(0);
    }
  }, [isRefreshing, restingDistance, setStatus, settle]);

  useTouchPull({ rootRef, gestureRef, disabledRef, refreshingRef, finishPull, updatePull });

  useEffect(() => {
    return () => animationRef.current?.stop();
  }, []);

  const startPointerPull = (event: ReactPointerEvent<HTMLElement>) => {
    // Everything but touch: a finger is driven by the native listeners above,
    // which can `preventDefault` the page scroll a passive React handler
    // cannot. A pen fires no touch events at all, so this is its only route.
    if (
      event.pointerType === "touch" ||
      event.button !== 0 ||
      event.currentTarget.scrollTop > 0 ||
      disabled ||
      isRefreshing
    ) {
      return;
    }

    capturePointer(event.currentTarget, event.pointerId);
    gestureRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
  };

  const movePointerPull = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (deltaY < 0 || Math.abs(deltaX) > deltaY) return;

    event.preventDefault();
    updatePull(deltaY);
  };

  const label =
    status === "refreshing" ? refreshingLabel : status === "ready" ? releaseLabel : pullingLabel;

  return (
    <section
      ref={rootRef}
      aria-label={ariaLabel}
      aria-busy={isRefreshing}
      data-state={status}
      data-disabled={disabled || undefined}
      onPointerDown={startPointerPull}
      onPointerMove={movePointerPull}
      onPointerUp={(event) => {
        if (gestureRef.current.pointerId === event.pointerId) finishPull();
      }}
      onPointerCancel={(event) => {
        if (gestureRef.current.pointerId === event.pointerId) finishPull();
      }}
      className={cn(
        "relative w-full overflow-y-auto overscroll-contain bg-background",
        // No `touch-none` here — this element is the scroller, and the pull
        // only takes over once the content is already at the top. The callout
        // has to be off from the first frame though: iOS decides on it while
        // the finger is still resting, long before the pull is recognised.
        // Whatever the consumer renders inside stays selectable with a mouse;
        // only the pull itself suppresses selection, and only while it runs,
        // so dragging the page down cannot highlight it on the way.
        TOUCH_GESTURE_CONTENT_CLASS,
        status === "pulling" || status === "ready" ? "cursor-grabbing select-none" : "cursor-grab",
        (disabled || isRefreshing) && "cursor-default",
        className,
      )}
    >
      <motion.div
        aria-live="polite"
        aria-atomic="true"
        style={
          reduce
            ? { opacity: indicatorOpacity }
            : { opacity: indicatorOpacity, scale: indicatorScale }
        }
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[4.25rem] flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-background via-background/95 to-transparent text-[11px] font-medium text-muted-foreground",
          indicatorClassName,
        )}
      >
        <RefreshBuddy progress={progress} status={status} reduce={Boolean(reduce)} />
        <span className="relative h-4 min-w-24 text-center">
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={status}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 3 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
              transition={LABEL_SWAP}
              className="absolute inset-x-0 whitespace-nowrap"
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.div>

      <motion.div
        style={reduce ? undefined : { y }}
        className={cn(
          "relative z-10 min-h-full bg-inherit will-change-transform",
          contentClassName,
        )}
      >
        {children}
      </motion.div>
    </section>
  );
}

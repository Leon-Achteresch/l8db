import type { Variants } from "motion/react";
import { EASE_IN_OUT, EASE_OUT } from "@/lib/ease";

export type DropKind = "capsule" | "thread" | "chip" | "splash";
export type DropPhase = "idle" | "swell" | "fall" | "open";
export type DropParts = Partial<
  Record<"blob" | "thread" | "drop" | "ring" | "text" | "icon", Variants>
> & { card: Variants };

export const GOO_FILTER_ID = "toast-drop-goo";
export const NEXT_PHASE: Partial<Record<DropPhase, DropPhase>> = { swell: "fall", fall: "open" };

const GRAVITY = [0.55, 0.085, 0.68, 0.53] as const;
const FLOOR = 204;
const INSTANT = { duration: 0 };

type Ease = readonly [number, number, number, number];

export function dropVariants(kind: DropKind, k: number): DropParts {
  const tween = (duration: number, ease: Ease = EASE_OUT, delay = 0) => ({
    duration: duration * k,
    ease,
    delay: delay * k,
  });
  const spring = (duration: number, bounce: number, delay = 0) =>
    k === 0
      ? INSTANT
      : { type: "spring" as const, duration: duration * k, bounce, delay: delay * k };
  const fade = (duration: number, delay = 0) => ({
    duration: k === 0 ? 0.15 : duration * k,
    delay: delay * k,
  });
  const rest = <T extends object>(value: T) => ({ idle: value, swell: value, fall: value });
  const reveal = (delay: number): Variants => ({
    ...rest({ opacity: 0, transition: fade(0.1) }),
    open: { opacity: 1, transition: fade(0.18, delay) },
  });

  if (kind === "capsule") {
    return {
      blob: {
        idle: { width: 20, height: 16, y: 14, borderRadius: 19, transition: tween(0.26) },
        swell: { width: 22, height: 28, y: 22, borderRadius: 19, transition: tween(0.18) },
        fall: { width: 16, height: 22, y: 50, borderRadius: 19, transition: tween(0.16, GRAVITY) },
        open: { width: 252, height: 38, y: 52, borderRadius: 19, transition: spring(0.42, 0.25) },
      },
      card: reveal(0.14),
    };
  }

  if (kind === "thread") {
    return {
      blob: {
        idle: { width: 24, height: 16, y: 14, borderRadius: 15, transition: tween(0.3) },
        swell: { width: 28, height: 30, y: 22, borderRadius: 15, transition: tween(0.2) },
        fall: {
          width: 30,
          height: 30,
          y: 58,
          borderRadius: 15,
          transition: tween(0.4, EASE_IN_OUT),
        },
        open: { width: 288, height: 60, y: 54, borderRadius: 14, transition: spring(0.5, 0.2) },
      },
      thread: {
        idle: { width: 10, height: 0, transition: INSTANT },
        swell: { width: 10, height: 0, transition: INSTANT },
        fall: { width: 10, height: 44, transition: tween(0.4, EASE_IN_OUT) },
        open: { width: 0, height: 44, transition: tween(0.22, EASE_OUT, 0.12) },
      },
      card: reveal(0.2),
    };
  }

  if (kind === "chip") {
    return {
      blob: {
        idle: { width: 20, height: 16, x: 0, y: 14, transition: tween(0.26) },
        swell: { width: 22, height: 28, x: 0, y: 22, transition: tween(0.18) },
        fall: { width: 16, height: 22, x: 0, y: 58, transition: tween(0.18, GRAVITY) },
        open: { width: 24, height: 24, x: -114, y: 62, transition: spring(0.45, 0.2) },
      },
      card: {
        ...rest({ width: 24, opacity: 0, transition: tween(0.2) }),
        open: {
          width: 280,
          opacity: 1,
          transition: { width: spring(0.45, 0.2), opacity: fade(0.1) },
        },
      },
      text: reveal(0.18),
      icon: reveal(0.2),
    };
  }

  return {
    drop: {
      idle: {
        transform: "translateY(16px) scaleX(0.6) scaleY(0.6)",
        opacity: 0,
        transition: INSTANT,
      },
      swell: {
        transform: "translateY(32px) scaleX(1) scaleY(1)",
        opacity: 1,
        transition: tween(0.2),
      },
      fall: {
        transform: `translateY(${FLOOR}px) scaleX(0.8) scaleY(1.3)`,
        opacity: 1,
        transition: tween(0.32, GRAVITY),
      },
      open: {
        transform: `translateY(${FLOOR + 8}px) scaleX(2.4) scaleY(0.3)`,
        opacity: 0,
        transition: tween(0.14),
      },
    },
    ring: {
      ...rest({ transform: "scale(0.3)", opacity: 0, transition: INSTANT }),
      open: { transform: "scale(1)", opacity: [0.7, 0], transition: tween(0.5) },
    },
    card: {
      ...rest({ transform: "translateY(10px) scale(0.92)", opacity: 0, transition: tween(0.16) }),
      open: {
        transform: "translateY(0px) scale(1)",
        opacity: 1,
        transition: { transform: spring(0.4, 0.25, 0.04), opacity: fade(0.12, 0.04) },
      },
    },
  };
}

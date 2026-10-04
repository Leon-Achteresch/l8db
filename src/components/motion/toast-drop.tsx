import { motion, useReducedMotion } from "motion/react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { EASE_IN_OUT, EASE_OUT } from "@/lib/ease";

type Phase = "idle" | "swell" | "fall" | "open" | "full";
type Drop = {
  key: number;
  from: "idle" | "full";
  phase: Phase;
  toast: HTMLElement;
  box: { left: number; top: number; width: number; height: number };
  center: number;
  edge: number;
  radius: number;
  background: string;
  border: string;
  target: { x: number; y: number; width: number; height: number };
};

const TOAST = "[data-sonner-toast]";
const PAD = 24;
const INSTANT = { duration: 0 };
const SWELL = { duration: 0.16, ease: EASE_OUT };
const SINK = { duration: 0.22, ease: EASE_IN_OUT };
const INFLATE = { type: "spring", duration: 0.4, bounce: 0.12 } as const;
const REVEAL_DELAY = 100;
const NEXT: Partial<Record<Phase, Phase>> = { swell: "fall", fall: "open" };

function measure(toast: HTMLElement) {
  const origin = document.querySelector("[data-toast-origin]")?.getBoundingClientRect();
  if (!origin?.width) return null;
  const target = toast.getBoundingClientRect();
  const style = getComputedStyle(toast);
  const center = origin.left + origin.width / 2;
  const left = Math.min(center - 40, target.left) - PAD;
  const top = origin.bottom - PAD;
  const right = Math.max(center + 40, target.right) + PAD;
  return {
    box: { left, top, width: right - left, height: target.bottom + PAD - top },
    center: center - left,
    edge: PAD,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 14,
    background: style.backgroundColor,
    border: style.borderTopColor,
    target: {
      x: target.left - left,
      y: target.top - top,
      width: target.width,
      height: target.height,
    },
  };
}

export function ToastDrop({ root }: { root: RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion();
  const [drop, setDrop] = useState<Drop | null>(null);
  const current = useRef<Drop | null>(null);
  const sequence = useRef(0);
  const timers = useRef(new Map<HTMLElement, number>());
  const reveal = useCallback((toast: HTMLElement) => {
    window.clearTimeout(timers.current.get(toast));
    timers.current.delete(toast);
    toast.setAttribute("data-dropped", "");
  }, []);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const pending = timers.current;
    container.querySelectorAll<HTMLElement>(TOAST).forEach(reveal);
    current.current = null;
    setDrop(null);

    const start = (next: Drop | null) => {
      current.current = next;
      setDrop(next);
    };

    const enter = (toast: HTMLElement) => {
      if (toast.dataset.front !== "true" || toast.dataset.yPosition !== "top") return reveal(toast);
      const previous = current.current?.toast;
      if (previous && previous !== toast) reveal(previous);
      const geometry = reduce ? null : measure(toast);
      if (!geometry) {
        start(null);
        return reveal(toast);
      }
      pending.set(
        toast,
        window.setTimeout(() => reveal(toast), 1000),
      );
      sequence.current += 1;
      start({ key: sequence.current, from: "idle", phase: "swell", toast, ...geometry });
    };

    const leave = (toast: HTMLElement) => {
      if (toast.dataset.yPosition !== "top") return;
      if (current.current && current.current.toast !== toast) return;
      if (!toast.hasAttribute("data-dropped")) {
        reveal(toast);
        start(null);
        return;
      }
      const geometry = reduce ? null : measure(toast);
      if (!geometry) return;
      sequence.current += 1;
      start({ key: sequence.current, from: "full", phase: "idle", toast, ...geometry });
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches(TOAST)) enter(node);
            else node.querySelectorAll<HTMLElement>(TOAST).forEach(enter);
          }
          if (current.current && !current.current.toast.isConnected) {
            reveal(current.current.toast);
            start(null);
          }
          continue;
        }
        const toast = record.target as HTMLElement;
        const { removed, front, swipeOut } = toast.dataset;
        if (removed === "true" && front === "true" && swipeOut !== "true") leave(toast);
      }
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-removed"],
    });
    return () => {
      observer.disconnect();
      pending.forEach((timer) => {
        window.clearTimeout(timer);
      });
      pending.clear();
    };
  }, [root, reduce, reveal]);

  useEffect(() => {
    if (drop?.phase !== "open") return;
    const timer = window.setTimeout(() => reveal(drop.toast), REVEAL_DELAY);
    return () => window.clearTimeout(timer);
  }, [drop, reveal]);

  if (!drop) return null;
  const { center, edge, radius, target } = drop;
  const full = {
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    borderRadius: radius,
  };
  const top = target.y + 4;

  return (
    <motion.div
      key={drop.key}
      aria-hidden="true"
      initial={drop.from}
      animate={drop.phase}
      onAnimationComplete={(label) => {
        const state = current.current;
        if (!state || state.key !== drop.key || state.phase !== label) return;
        if (state.phase === "open") reveal(state.toast);
        const next = NEXT[state.phase];
        current.current = next ? { ...state, phase: next } : null;
        setDrop(current.current);
      }}
      className="pointer-events-none fixed z-[999999998]"
      style={{
        ...drop.box,
        filter: "url(#l8-toast-goo)",
        clipPath: `inset(${edge}px 0 0 0)`,
      }}
    >
      <svg aria-hidden="true" className="absolute size-0">
        <filter id="l8-toast-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -7.5" result="goo" />
          <feMorphology operator="dilate" radius="1" result="grown" />
          <feFlood style={{ floodColor: drop.border }} />
          <feComposite in2="grown" operator="in" result="rim" />
          <feComposite in="goo" in2="rim" operator="over" />
        </filter>
      </svg>
      <div
        className="absolute h-3 w-[60px] rounded-full"
        style={{ left: center - 30, top: edge - 13, background: drop.background }}
      />
      <motion.div
        className="absolute top-0 left-0 rounded-full"
        style={{ background: drop.background }}
        variants={{
          idle: { x: center - 5, y: edge - 6, width: 10, height: 0, transition: INSTANT },
          swell: { x: center - 5, y: edge - 6, width: 10, height: 0, transition: INSTANT },
          fall: { x: center - 5, width: 10, height: top + 21 - edge, transition: SINK },
          open: {
            x: center,
            width: 0,
            transition: { duration: 0.15, ease: EASE_OUT, delay: 0.08 },
          },
          full: { width: 0, height: 0, transition: INSTANT },
        }}
      />
      <motion.div
        className="absolute top-0 left-0"
        style={{ background: drop.background }}
        variants={{
          idle: {
            x: center - 12,
            y: edge - 22,
            width: 24,
            height: 16,
            borderRadius: 15,
            transition: { duration: 0.18, ease: EASE_OUT },
          },
          swell: {
            x: center - 14,
            y: edge - 14,
            width: 28,
            height: 30,
            borderRadius: 15,
            transition: SWELL,
          },
          fall: {
            x: center - 15,
            y: top,
            width: 30,
            height: 30,
            borderRadius: 15,
            transition: SINK,
          },
          open: { ...full, transition: INFLATE },
          full: { ...full, transition: INSTANT },
        }}
      />
    </motion.div>
  );
}

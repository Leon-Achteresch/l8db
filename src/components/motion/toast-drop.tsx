import { motion, useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useRef, useState } from "react";
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
  target: { x: number; y: number; width: number; height: number };
};

const TOAST = "[data-sonner-toast]";
const PAD = 24;
const INSTANT = { duration: 0 };
const SWELL = { duration: 0.38, ease: EASE_OUT };
const SINK = { duration: 0.75, ease: EASE_IN_OUT };
const INFLATE = { type: "spring", duration: 0.95, bounce: 0.2 } as const;
const REVEAL_DELAY = 370;
const NEXT: Partial<Record<Phase, Phase>> = { swell: "fall", fall: "open" };

const reveal = (toast: HTMLElement) => toast.setAttribute("data-dropped", "");

function measure(toast: HTMLElement) {
  const origin = document.querySelector("[data-toast-origin]")?.getBoundingClientRect();
  if (!origin?.width) return null;
  const target = toast.getBoundingClientRect();
  const center = origin.left + origin.width / 2;
  const left = Math.min(center - 40, target.left) - PAD;
  const top = origin.bottom - PAD;
  const right = Math.max(center + 40, target.right) + PAD;
  return {
    box: { left, top, width: right - left, height: target.bottom + PAD - top },
    center: center - left,
    edge: PAD,
    radius: Number.parseFloat(getComputedStyle(toast).borderTopLeftRadius) || 14,
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
  current.current = drop;

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    let key = 0;
    container.querySelectorAll<HTMLElement>(TOAST).forEach(reveal);

    const enter = (toast: HTMLElement) => {
      const previous = current.current?.toast;
      if (previous && previous !== toast) reveal(previous);
      window.setTimeout(() => reveal(toast), 2500);
      const geometry = reduce ? null : measure(toast);
      if (!geometry) return reveal(toast);
      key += 1;
      setDrop({ key, from: "idle", phase: "swell", toast, ...geometry });
    };

    const leave = (toast: HTMLElement) => {
      const geometry = reduce ? null : measure(toast);
      if (!geometry) return;
      key += 1;
      setDrop({ key, from: "full", phase: "idle", toast, ...geometry });
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.matches(TOAST)) enter(node);
            else node.querySelectorAll<HTMLElement>(TOAST).forEach(enter);
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
    return () => observer.disconnect();
  }, [root, reduce]);

  useEffect(() => {
    if (drop?.phase !== "open") return;
    const timer = window.setTimeout(() => reveal(drop.toast), REVEAL_DELAY);
    return () => window.clearTimeout(timer);
  }, [drop]);

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
      onAnimationComplete={(label) =>
        setDrop((state) => {
          if (!state || state.phase !== label) return state;
          const next = NEXT[state.phase];
          return next ? { ...state, phase: next } : null;
        })
      }
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
          <feFlood style={{ floodColor: "var(--border)" }} />
          <feComposite in2="grown" operator="in" result="rim" />
          <feComposite in="goo" in2="rim" operator="over" />
        </filter>
      </svg>
      <div
        className="absolute h-3 w-[60px] rounded-full bg-card"
        style={{ left: center - 30, top: edge - 13 }}
      />
      <motion.div
        className="absolute top-0 left-0 rounded-full bg-card"
        variants={{
          idle: { x: center - 5, y: edge - 6, width: 10, height: 0, transition: INSTANT },
          swell: { x: center - 5, y: edge - 6, width: 10, height: 0, transition: INSTANT },
          fall: { x: center - 5, width: 10, height: top + 21 - edge, transition: SINK },
          open: {
            x: center,
            width: 0,
            transition: { duration: 0.4, ease: EASE_OUT, delay: 0.22 },
          },
          full: { width: 0, height: 0, transition: INSTANT },
        }}
      />
      <motion.div
        className="absolute top-0 left-0 bg-card"
        variants={{
          idle: {
            x: center - 12,
            y: edge - 22,
            width: 24,
            height: 16,
            borderRadius: 15,
            transition: { duration: 0.3, ease: EASE_OUT },
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

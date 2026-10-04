import { type Easing, motion, useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { EASE_IN_OUT, EASE_OUT } from "@/lib/ease";

type Anchor = "start" | "mid" | "end";
type Drop = {
  key: number;
  leaving: boolean;
  toast: HTMLElement;
  box: { left: number; top: number; width: number; height: number };
  center: number;
  radius: number;
  background: string;
  border: string;
  target: { x: number; y: number; width: number; height: number };
};

const TOAST = "[data-sonner-toast]";
const PAD = 24;
const NECK = 10;
const FLAT = 0.001;
const FULL = "translate(0px, 0px) scale(1, 1)";
const SWELL = 0.16;
const FALL = 0.22;
const ENTER = SWELL + FALL + 0.4;
const ENTER_TIMES = [0, SWELL / ENTER, (SWELL + FALL) / ENTER, 1];
const ENTER_EASE = [EASE_OUT, EASE_IN_OUT, EASE_OUT];
const NECK_TIMES = [
  ...ENTER_TIMES.slice(0, 3),
  (SWELL + FALL + 0.08) / ENTER,
  (SWELL + FALL + 0.23) / ENTER,
  1,
];
const NECK_FRAMES = [
  `scale(1, ${FLAT})`,
  `scale(1, ${FLAT})`,
  "scale(1, 1)",
  "scale(1, 1)",
  `scale(${FLAT}, 1)`,
  `scale(${FLAT}, 1)`,
];
const NECK_EASE: Easing[] = ["linear", EASE_IN_OUT, "linear", EASE_OUT, "linear"];
const RISE = { duration: 0.18, ease: EASE_OUT };
const PIECES: [Anchor, Anchor][] = [
  ["mid", "mid"],
  ["mid", "start"],
  ["mid", "end"],
  ["start", "mid"],
  ["end", "mid"],
  ["start", "start"],
  ["end", "start"],
  ["start", "end"],
  ["end", "end"],
];

function settle(toast: HTMLElement) {
  toast.setAttribute("data-dropped", "");
}

function measure(toast: HTMLElement) {
  const origin = document.querySelector("[data-toast-origin]")?.getBoundingClientRect();
  if (!origin?.width) return null;
  const target = toast.getBoundingClientRect();
  const style = getComputedStyle(toast);
  const center = origin.left + origin.width / 2;
  const left = Math.min(center - 40, target.left) - PAD;
  const top = origin.bottom;
  const right = Math.max(center + 40, target.right) + PAD;
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 14;
  return {
    box: { left, top, width: right - left, height: target.bottom + PAD - top },
    center: center - left,
    radius: Math.max(1, Math.min(radius, target.width / 2 - 1, target.height / 2 - 1)),
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

function span(anchor: Anchor, start: number, size: number, radius: number): [number, number] {
  if (anchor === "start") return [start, radius + 1];
  if (anchor === "end") return [start + size - radius - 1, radius + 1];
  return [start + radius, size - 2 * radius];
}

function fold(anchor: Anchor, start: number, size: number, at: number, radius: number, k: number) {
  if (anchor === "mid") return { offset: at - start, scale: FLAT };
  if (anchor === "start") return { offset: at - radius * k - start, scale: k };
  return { offset: at + radius * k - size * k - start, scale: k };
}

export function ToastDrop({ root }: { root: RefObject<HTMLElement | null> }) {
  const reduce = useReducedMotion();
  const [drop, setDrop] = useState<Drop | null>(null);
  const current = useRef<Drop | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>(TOAST).forEach(settle);
    current.current = null;
    setDrop(null);

    const start = (next: Drop | null) => {
      current.current = next;
      setDrop(next);
    };

    const enter = (toast: HTMLElement) => {
      if (toast.dataset.front !== "true") return settle(toast);
      const previous = current.current?.toast;
      if (previous && previous !== toast) settle(previous);
      const geometry = reduce ? null : measure(toast);
      if (!geometry) {
        start(null);
        return settle(toast);
      }
      toast.setAttribute("data-dropped", "drop");
      sequence.current += 1;
      start({ key: sequence.current, leaving: false, toast, ...geometry });
    };

    const leave = (toast: HTMLElement) => {
      if (current.current && current.current.toast !== toast) return;
      if (!toast.hasAttribute("data-dropped")) {
        settle(toast);
        start(null);
        return;
      }
      const geometry = reduce ? null : measure(toast);
      if (!geometry) return;
      sequence.current += 1;
      start({ key: sequence.current, leaving: true, toast, ...geometry });
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
            settle(current.current.toast);
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
    return () => observer.disconnect();
  }, [root, reduce]);

  if (!drop) return null;
  const { center, radius, target, background, border, leaving } = drop;
  const drip = target.y + radius + 4;
  const finish = () => {
    if (current.current?.key !== drop.key) return;
    if (!leaving) settle(drop.toast);
    current.current = null;
    setDrop(null);
  };

  return (
    <div
      key={drop.key}
      aria-hidden="true"
      className="pointer-events-none fixed z-[999999998] overflow-hidden"
      style={drop.box}
    >
      {leaving ? null : (
        <motion.div
          className="absolute top-0 border-x border-solid"
          style={{
            left: center - NECK / 2,
            width: NECK,
            height: drip,
            background,
            borderColor: border,
            transformOrigin: "50% 0",
          }}
          initial={{ transform: NECK_FRAMES[0] }}
          animate={{ transform: NECK_FRAMES }}
          transition={{ duration: ENTER, times: NECK_TIMES, ease: NECK_EASE }}
        />
      )}
      {PIECES.map(([x, y], index) => {
        const [left, width] = span(x, target.x, target.width, radius);
        const [top, height] = span(y, target.y, target.height, radius);
        const folded = (at: number, k: number) => {
          const across = fold(x, left, width, center, radius, k);
          const down = fold(y, top, height, at, radius, k);
          return `translate(${across.offset}px, ${down.offset}px) scale(${across.scale}, ${down.scale})`;
        };
        const hidden = folded(-radius, 0.8);
        return (
          <motion.div
            key={`${x}-${y}`}
            className="absolute border-solid"
            style={{
              left,
              top,
              width,
              height,
              background,
              borderColor: border,
              borderLeftWidth: x === "start" ? 1 : 0,
              borderRightWidth: x === "end" ? 1 : 0,
              borderTopWidth: y === "start" ? 1 : 0,
              borderBottomWidth: y === "end" ? 1 : 0,
              borderTopLeftRadius: x === "start" && y === "start" ? radius : 0,
              borderTopRightRadius: x === "end" && y === "start" ? radius : 0,
              borderBottomLeftRadius: x === "start" && y === "end" ? radius : 0,
              borderBottomRightRadius: x === "end" && y === "end" ? radius : 0,
              transformOrigin: "0 0",
            }}
            initial={{ transform: leaving ? FULL : hidden }}
            animate={{
              transform: leaving ? hidden : [hidden, folded(2, 0.9), folded(drip, 1), FULL],
            }}
            transition={leaving ? RISE : { duration: ENTER, times: ENTER_TIMES, ease: ENTER_EASE }}
            onAnimationComplete={index === 0 ? finish : undefined}
          />
        );
      })}
    </div>
  );
}

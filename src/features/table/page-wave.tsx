import { animate } from "motion/react";
import type { CSSProperties, Ref } from "react";
import { cn } from "@/lib/utils";

const LAYERS = [
  { spread: 100, height: 24, opacity: 0.7 },
  { spread: 170, height: 16, opacity: 0.35 },
  { spread: 260, height: 9, opacity: 0.18 },
];

function wavePath(direction: "up" | "down", spread: number, height: number) {
  const base = direction === "down" ? 32 : 8;
  const peak = direction === "down" ? base - height : base + height;
  const edge = direction === "down" ? 40 : 0;
  const left = 300 - spread;
  const right = 300 + spread;
  return [
    `M0 ${base}`,
    `H${left}`,
    `C${left + spread / 2} ${base} ${300 - spread / 2} ${peak} 300 ${peak}`,
    `C${300 + spread / 2} ${peak} ${right - spread / 2} ${base} ${right} ${base}`,
    `H600`,
    `V${edge}`,
    `H0`,
    "Z",
  ].join(" ");
}

export function PageWave({
  direction,
  ref,
  className,
  style,
}: {
  direction: "up" | "down";
  ref?: Ref<SVGSVGElement>;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      ref={ref}
      aria-hidden
      viewBox="0 0 600 40"
      preserveAspectRatio="none"
      style={style}
      className={cn(
        "h-6 w-full text-primary",
        direction === "up" ? "origin-top" : "origin-bottom",
        className,
      )}
    >
      {LAYERS.map((layer) => (
        <path
          key={layer.spread}
          d={wavePath(direction, layer.spread, layer.height)}
          fill="currentColor"
          fillOpacity={layer.opacity}
        />
      ))}
    </svg>
  );
}

export function animatePageWave(element: Element) {
  return animate(
    element,
    { opacity: [0, 1, 1, 0], scaleY: [0.25, 1.15, 1, 0.25] },
    { duration: 1.1, times: [0, 0.15, 0.6, 1], ease: "easeInOut" },
  );
}

import { useLayoutEffect, useRef } from "react";
import { newFeatureJustSeen } from "@/lib/new-features";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

const RISE = "cubic-bezier(0.22, 1, 0.36, 1)";
const FALL = "cubic-bezier(0.55, 0, 1, 0.45)";
const DURATION_MS = 720;

function tumbleAway(badge: HTMLElement) {
  const rect = badge.getBoundingClientRect();
  if (rect.width === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ghost = badge.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("role");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "2147483647",
  });
  document.body.appendChild(ghost);
  ghost.animate(
    [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.8 },
      { opacity: 0, offset: 1 },
    ],
    { duration: DURATION_MS, fill: "forwards" },
  );
  ghost.animate(
    [
      { transform: "translate(0, 0) rotate(0deg) scaleY(1)", easing: RISE, offset: 0 },
      { transform: "translate(0, 1.5px) rotate(-5deg) scaleY(0.85)", easing: RISE, offset: 0.16 },
      { transform: "translate(3px, -11px) rotate(10deg) scaleY(1.05)", easing: FALL, offset: 0.46 },
      { transform: "translate(14px, 30px) rotate(80deg) scaleY(1)", offset: 1 },
    ],
    { duration: DURATION_MS, fill: "forwards" },
  ).onfinish = () => ghost.remove();
}

export function NewBadge({ className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const badge = ref.current;
    return () => {
      if (badge && newFeatureJustSeen()) tumbleAway(badge);
    };
  }, []);

  return (
    <span
      ref={ref}
      role="img"
      aria-label="Neu"
      className={cn(
        "pointer-events-none inline-flex shrink-0 items-center rounded-xl bg-primary px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide text-primary-foreground",
        className,
      )}
    >
      NEW
    </span>
  );
}

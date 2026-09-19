import { type MotionValue, motion, useTransform } from "motion/react";
import { SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { CALM_PULSE, CHARACTER_LOOP } from "./constants";
import type { PullToRefreshStatus } from "./types";

export function RefreshBuddy({
  progress,
  status,
  reduce,
}: {
  progress: MotionValue<number>;
  status: PullToRefreshStatus;
  reduce: boolean;
}) {
  const lift = useTransform(progress, [0, 1], [-7, 0]);
  const tilt = useTransform(progress, [0, 1], [-10, 0]);
  const stretch = useTransform(progress, [0, 0.55, 1], [0.68, 1.1, 0.92]);
  const ready = status === "ready";
  const refreshing = status === "refreshing";

  return (
    <motion.span
      style={reduce ? undefined : { y: lift, rotate: tilt, scaleY: stretch }}
      className="block h-9 w-9 origin-bottom"
    >
      <motion.svg
        aria-hidden="true"
        viewBox="0 0 36 36"
        style={{ opacity: 1 }}
        className="h-full w-full overflow-visible"
        animate={
          refreshing
            ? reduce
              ? { opacity: [0.55, 1, 0.55] }
              : { y: [0, -2, 0], rotate: [-3, 3, -3] }
            : reduce
              ? { opacity: 1 }
              : { y: 0, rotate: 0, scale: ready ? 1.08 : 1 }
        }
        transition={refreshing ? (reduce ? CALM_PULSE : CHARACTER_LOOP) : SPRING_SWAP}
      >
        <motion.g
          style={{ transformOrigin: "18px 18px" }}
          animate={
            refreshing && !reduce
              ? { rotate: [0, 360] }
              : reduce
                ? undefined
                : { rotate: ready ? 0 : -35 }
          }
          transition={refreshing ? (reduce ? CALM_PULSE : CHARACTER_LOOP) : SPRING_SWAP}
          className={cn(
            "transition-opacity duration-150",
            ready || refreshing ? "opacity-100" : "opacity-0",
          )}
        >
          <path
            d="M18 2.5a15.5 15.5 0 0 1 12.7 6.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-muted-foreground"
          />
          <circle cx="31.3" cy="10.2" r="2.2" className="fill-foreground" />
        </motion.g>

        <rect x="7" y="7" width="22" height="22" rx="9" className="fill-foreground" />

        <motion.g
          style={{ opacity: 1, transformOrigin: "18px 16px" }}
          animate={
            refreshing && !reduce
              ? { scaleY: [1, 1, 0.15, 1, 1] }
              : reduce
                ? { opacity: 1 }
                : { scaleY: ready ? 1.18 : 1 }
          }
          transition={refreshing && !reduce ? CHARACTER_LOOP : SPRING_SWAP}
        >
          <circle cx="14.2" cy="16" r="1.45" className="fill-background" />
          <circle cx="21.8" cy="16" r="1.45" className="fill-background" />
        </motion.g>

        <path
          d="M14.5 21h7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={cn(
            "text-background transition-opacity duration-150",
            ready || refreshing ? "opacity-0" : "opacity-100",
          )}
        />
        <path
          d="M14 20.5c1 2.4 7 2.4 8 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={cn(
            "text-background transition-opacity duration-150",
            ready ? "opacity-100" : "opacity-0",
          )}
        />
        <circle
          cx="18"
          cy="21"
          r="1.6"
          className={cn(
            "fill-background transition-opacity duration-150",
            refreshing ? "opacity-100" : "opacity-0",
          )}
        />
      </motion.svg>
    </motion.span>
  );
}

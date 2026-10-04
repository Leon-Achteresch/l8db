import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

const PATH = "M0,40 C120,-10 280,90 400,40";
const PACKETS = 9;

export function TransferCinemaStream({
  active,
  state,
  table,
  tableKey,
}: {
  active: boolean;
  state: "idle" | "running" | "success" | "failure";
  table: string | null;
  tableKey: string;
}) {
  const reduce = useReducedMotion();
  const color = state === "failure" ? "#f87171" : state === "success" ? "#34d399" : "#38bdf8";
  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center self-stretch">
      <motion.svg
        aria-hidden
        viewBox="0 0 400 80"
        preserveAspectRatio="none"
        className="h-20 w-full overflow-visible"
        initial={reduce ? false : { opacity: 0, scaleX: 0.3 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.35 }}
      >
        <defs>
          <linearGradient id="transfer-stream-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0" />
            <stop offset="0.2" stopColor={color} stopOpacity="0.6" />
            <stop offset="0.8" stopColor={color} stopOpacity="0.6" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <filter id="transfer-stream-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
        </defs>
        <path
          d={PATH}
          fill="none"
          stroke="url(#transfer-stream-line)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {active &&
          !reduce &&
          Array.from({ length: PACKETS }, (_, index) => `${0.9 + index * 0.21}s`).map((begin) => {
            return (
              <g key={begin} opacity={0}>
                <circle r={5} fill={color} opacity={0.5} filter="url(#transfer-stream-glow)">
                  <animateMotion
                    dur="1.9s"
                    begin={begin}
                    repeatCount="indefinite"
                    path={PATH}
                    calcMode="spline"
                    keySplines="0.4 0 0.6 1"
                    keyTimes="0;1"
                  />
                </circle>
                <circle r={2.2} fill="white">
                  <animateMotion
                    dur="1.9s"
                    begin={begin}
                    repeatCount="indefinite"
                    path={PATH}
                    calcMode="spline"
                    keySplines="0.4 0 0.6 1"
                    keyTimes="0;1"
                  />
                </circle>
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.12;0.85;1"
                  dur="1.9s"
                  begin={begin}
                  repeatCount="indefinite"
                />
              </g>
            );
          })}
      </motion.svg>
      <div className="relative h-8 w-full">
        <AnimatePresence mode="popLayout" initial={false}>
          {table && (
            <motion.span
              key={tableKey}
              className={cn(
                "absolute left-1/2 top-0 max-w-full truncate rounded-full border px-3 py-1 font-mono text-xs backdrop-blur-sm",
                state === "failure"
                  ? "border-red-400/40 bg-red-500/10 text-red-200"
                  : "border-white/15 bg-white/[0.07] text-white/90",
              )}
              initial={reduce ? { x: "-50%", opacity: 0 } : { x: "-160%", opacity: 0, scale: 0.9 }}
              animate={{ x: "-50%", opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { x: "60%", opacity: 0, scale: 0.9 }}
              transition={SPRING_SWAP}
            >
              {table}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

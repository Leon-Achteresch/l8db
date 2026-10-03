import { motion, useReducedMotion } from "motion/react";
import { ProviderLogo } from "@/components/provider-logo";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { SPRING } from "@/lib/ease";
import { cn } from "@/lib/utils";

const CHECK = "M9 16.5l4.5 4.5L23 11.5";
const CROSS = "M11 11l10 10M21 11L11 21";

export function TransferCinemaNode({
  connection,
  database,
  caption,
  percent,
  state,
  delay,
}: {
  connection: SavedConnection;
  database: string | null;
  caption: string;
  percent: number | null;
  state: "idle" | "running" | "success" | "failure";
  delay: number;
}) {
  const reduce = useReducedMotion();
  const tone =
    state === "success"
      ? "text-emerald-400"
      : state === "failure"
        ? "text-red-400"
        : "text-sky-400";
  return (
    <motion.div
      className="flex w-44 flex-col items-center gap-3"
      initial={reduce ? false : { opacity: 0, scale: 0.6, filter: "blur(12px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ ...SPRING, delay }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/40">
        {caption}
      </span>
      <motion.div
        className="relative flex size-28 items-center justify-center"
        animate={state === "failure" && !reduce ? { x: [0, -10, 10, -7, 7, -3, 3, 0] } : { x: 0 }}
        transition={{ duration: 0.55, ease: "easeInOut" }}
      >
        {state === "success" &&
          !reduce &&
          [0, 1, 2].map((ring) => (
            <motion.span
              key={ring}
              className="absolute inset-0 rounded-full border-2 border-emerald-400"
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 2.8, opacity: 0 }}
              transition={{ duration: 1.4, ease: "easeOut", delay: ring * 0.22 }}
            />
          ))}
        {state === "success" &&
          !reduce &&
          Array.from({ length: 14 }, (_, index) => {
            const angle = (index / 14) * Math.PI * 2;
            return (
              <motion.span
                key={`spark-${angle}`}
                className="absolute size-1.5 rounded-full bg-emerald-300"
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos(angle) * 110,
                  y: Math.sin(angle) * 110,
                  opacity: 0,
                  scale: 0.2,
                }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
              />
            );
          })}
        <motion.div
          className={cn(
            "absolute inset-0 rounded-full blur-2xl",
            state === "success"
              ? "bg-emerald-400/50"
              : state === "failure"
                ? "bg-red-500/40"
                : "bg-sky-400/30",
          )}
          animate={state === "running" && !reduce ? { opacity: [0.5, 1, 0.5] } : { opacity: 0.9 }}
          transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        {percent !== null && (
          <svg
            aria-hidden
            viewBox="0 0 112 112"
            className={cn("absolute inset-0 size-full -rotate-90", tone)}
          >
            <circle
              cx="56"
              cy="56"
              r="52"
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={3}
            />
            <motion.circle
              cx="56"
              cy="56"
              r="52"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(0.01, percent / 100) }}
              transition={{ ...SPRING, stiffness: 120, damping: 26 }}
            />
          </svg>
        )}
        <div
          className={cn(
            "relative flex size-[88px] items-center justify-center rounded-full border bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-colors duration-500",
            state === "success"
              ? "border-emerald-400/60"
              : state === "failure"
                ? "border-red-400/60"
                : "border-white/15",
          )}
        >
          <ProviderLogo
            providerId={providerFor(connection).id}
            kind={connection.kind}
            className="size-9 text-white"
          />
          {percent !== null && (state === "success" || state === "failure") && (
            <motion.span
              className={cn(
                "absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full",
                state === "success" ? "bg-emerald-500" : "bg-red-500",
              )}
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...SPRING, delay: 0.1 }}
            >
              <motion.svg
                aria-hidden
                viewBox="0 0 32 32"
                className="size-5"
                fill="none"
                stroke="white"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <motion.path
                  d={state === "success" ? CHECK : CROSS}
                  initial={reduce ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: "easeOut", delay: 0.25 }}
                />
              </motion.svg>
            </motion.span>
          )}
        </div>
      </motion.div>
      <div className="flex min-w-0 max-w-full flex-col items-center">
        <span className="max-w-full truncate text-sm font-medium text-white">
          {connection.name}
        </span>
        {database && (
          <span className="max-w-full truncate font-mono text-[11px] text-white/50">
            {database}
          </span>
        )}
      </div>
    </motion.div>
  );
}

import { CheckIcon, Search, XIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type DropKind,
  type DropPhase,
  dropVariants,
  GOO_FILTER_ID,
  NEXT_PHASE,
} from "./toast-drop-variants";

export type DropTone = "success" | "error";

const TONES = {
  success: {
    color: "oklch(0.72 0.19 155)",
    Icon: CheckIcon,
    title: "Änderungen gespeichert",
    description: "3 Zeilen in public.orders",
  },
  error: {
    color: "oklch(0.63 0.24 25)",
    Icon: XIcon,
    title: "Verbindung fehlgeschlagen",
    description: "Zeitüberschreitung nach 10 s",
  },
} as const;

const ROW = "pointer-events-none absolute inset-x-0 top-0 flex items-start justify-center";
const CARD_ROW = {
  capsule: "top-[52px]",
  thread: "top-[54px]",
  chip: "top-[50px]",
  splash: "top-auto bottom-3",
};
const STATIC = { transition: "none" };

export function ToastDropPreview({
  kind,
  tone,
  slow,
  run,
}: {
  kind: DropKind;
  tone: DropTone;
  slow: boolean;
  run: number;
}) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<DropPhase>("idle");
  const k = reduce ? 0 : slow ? 6 : 1;
  const parts = useMemo(() => dropVariants(kind, k), [kind, k]);
  const { color, Icon, title, description } = TONES[tone];
  const glass = kind === "chip" || kind === "splash";

  useEffect(() => {
    if (run > 0) setPhase(reduce ? "open" : "swell");
  }, [run, reduce]);

  useEffect(() => {
    if (phase !== "open") return;
    const timer = window.setTimeout(() => setPhase("idle"), 2800 + 400 * k);
    return () => window.clearTimeout(timer);
  }, [phase, k]);

  const icon = (
    <span className={cn("l8-toast-icon", kind === "capsule" && "rounded-full")}>
      <Icon className="size-4 shrink-0" />
    </span>
  );
  const copy = (
    <span className="min-w-0">
      <span className="l8-toast-title block truncate">{title}</span>
      {kind !== "capsule" && (
        <span className="l8-toast-description block truncate">{description}</span>
      )}
    </span>
  );
  const card = (
    <div className={cn(ROW, CARD_ROW[kind])}>
      <motion.div
        role="status"
        variants={parts.card}
        style={kind === "chip" ? { ...STATIC, padding: 0 } : STATIC}
        className={cn(
          `l8-toast--${tone} flex flex-none items-center gap-2.5 text-[13px] leading-[1.4]`,
          kind === "capsule" &&
            "h-[38px] w-[252px] gap-2 rounded-[19px] px-2 text-card-foreground shadow-[0_6px_24px_-6px_oklch(0_0_0/0.18)]",
          kind === "thread" &&
            "h-[60px] w-[288px] rounded-[14px] px-3.5 text-card-foreground shadow-[0_6px_24px_-6px_oklch(0_0_0/0.18)]",
          kind === "chip" && "l8-toast relative h-12 overflow-hidden",
          kind === "splash" && "l8-toast w-[280px]",
        )}
      >
        {kind === "chip" ? (
          <motion.div
            variants={parts.text}
            className="absolute top-0 left-1/2 flex h-full w-[280px] -translate-x-1/2 items-center pr-3.5 pl-12"
          >
            {copy}
          </motion.div>
        ) : (
          <>
            {icon}
            {copy}
          </>
        )}
      </motion.div>
    </div>
  );

  return (
    <motion.div
      initial="idle"
      animate={phase}
      onAnimationComplete={(label) =>
        setPhase((current) => (current === label ? (NEXT_PHASE[current] ?? current) : current))
      }
      className="relative h-[248px] overflow-hidden rounded-xl border border-border/70 bg-background"
    >
      <div className="absolute inset-x-0 top-0 h-11 border-b border-border/70 bg-sidebar/50" />
      <div className="absolute inset-x-6 top-[68px] space-y-3.5">
        {["w-2/5", "w-full", "w-11/12", "w-3/4", "w-5/6", "w-4/5", "w-2/3"].map((width) => (
          <div key={width} className={cn("h-2 rounded-full bg-muted", width)} />
        ))}
      </div>
      {glass && card}
      {kind === "splash" ? (
        <>
          <div className={ROW}>
            <motion.div variants={parts.drop} className="flex-none">
              <div
                className="size-3 rotate-45 rounded-[0_50%_50%_50%]"
                style={{ backgroundColor: color }}
              />
            </motion.div>
          </div>
          <div className={cn(ROW, "top-[202px]")}>
            <motion.div
              variants={parts.ring}
              className="h-5 w-24 flex-none rounded-[50%] border-2"
              style={{ borderColor: color }}
            />
          </div>
        </>
      ) : (
        <div className="absolute inset-0" style={{ filter: `url(#${GOO_FILTER_ID})` }}>
          <div className={ROW}>
            <motion.div
              variants={parts.blob}
              className="flex-none rounded-full bg-card"
              style={kind === "chip" ? { backgroundColor: color } : undefined}
            />
          </div>
          {parts.thread && (
            <div className={cn(ROW, "top-[30px]")}>
              <motion.div variants={parts.thread} className="flex-none rounded-full bg-card" />
            </div>
          )}
          <div className={ROW}>
            <div className="mt-2 h-7 w-[200px] rounded-full bg-card" />
          </div>
        </div>
      )}
      <div className={ROW}>
        <div
          className={cn(
            "mt-2 flex h-7 w-[200px] items-center gap-2 rounded-full border border-transparent px-3 text-xs text-muted-foreground",
            kind === "splash" && "border-border bg-card",
          )}
        >
          <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={2} />
          <span className="flex-1">Suchen</span>
          <kbd className="rounded-full border border-border/60 px-1.5 py-px font-sans text-[10px]">
            ⌘K
          </kbd>
        </div>
      </div>
      {!glass && card}
      {parts.icon && (
        <div className={cn(ROW, "top-[62px]")}>
          <motion.div
            variants={parts.icon}
            className="-translate-x-[114px] flex size-6 flex-none items-center justify-center text-white"
          >
            <Icon className="size-4" strokeWidth={2.5} />
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

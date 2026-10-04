import { Search } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { IslandEmoji } from "@/features/shell/dynamic-island/island-emoji";
import { IslandRing } from "@/features/shell/dynamic-island/island-ring";
import { IslandWaveform } from "@/features/shell/dynamic-island/island-waveform";
import type { IslandGlyph } from "@/lib/dynamic-island";
import { SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

const CHECK_PATH = "M3.5 8.5l3 3 6-7";
const CROSS_PATH = "M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5";

export function IslandSymbol({ glyph }: { glyph: IslandGlyph }) {
  const reduce = useReducedMotion();
  if (glyph.kind === "search")
    return <Search aria-hidden className="size-3.5 shrink-0 text-current/60" strokeWidth={2} />;
  if (glyph.kind === "wave") return <IslandWaveform color={glyph.color} />;
  if (glyph.kind === "ring") return <IslandRing percent={glyph.percent} />;
  if (glyph.kind === "emoji") return <IslandEmoji emoji={glyph.emoji} effect={glyph.effect} />;
  if (glyph.kind === "icon") {
    const Icon = glyph.icon;
    return <Icon aria-hidden className="size-3.5 shrink-0 text-current/70" strokeWidth={2} />;
  }
  if (glyph.kind === "dot")
    return (
      <span aria-hidden className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span
          className="absolute size-2 animate-ping rounded-full opacity-60 motion-reduce:hidden"
          style={{ background: glyph.color }}
        />
        <span className="relative size-2 rounded-full" style={{ background: glyph.color }} />
      </span>
    );
  return (
    <motion.span
      aria-hidden
      initial={reduce ? false : { transform: "scale(0.3)" }}
      animate={{ transform: "scale(1)" }}
      transition={SPRING_PRESS}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full",
        glyph.kind === "check" ? "bg-emerald-500" : "bg-red-500",
      )}
    >
      <motion.svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-2.5"
        fill="none"
        stroke="white"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { opacity: 0, transform: "scale(0.4) rotate(-35deg)" }}
        animate={{ opacity: 1, transform: "scale(1) rotate(0deg)" }}
        transition={{ ...SPRING_PRESS, delay: 0.1 }}
      >
        <path d={glyph.kind === "check" ? CHECK_PATH : CROSS_PATH} />
      </motion.svg>
    </motion.span>
  );
}

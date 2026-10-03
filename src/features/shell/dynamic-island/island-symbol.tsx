import { Search } from "lucide-react";
import { motion } from "motion/react";
import { IslandEmoji } from "@/features/shell/dynamic-island/island-emoji";
import { IslandRing } from "@/features/shell/dynamic-island/island-ring";
import { IslandWaveform } from "@/features/shell/dynamic-island/island-waveform";
import type { IslandGlyph } from "@/lib/dynamic-island";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

const CHECK_PATH = "M3.5 8.5l3 3 6-7";
const CROSS_PATH = "M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5";

export function IslandSymbol({ glyph }: { glyph: IslandGlyph }) {
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
        <motion.span
          className="absolute size-2 rounded-full"
          style={{ background: glyph.color }}
          animate={{ scale: [1, 2.4], opacity: [0.55, 0] }}
          transition={{
            duration: 1.6,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeOut",
          }}
        />
        <span className="relative size-2 rounded-full" style={{ background: glyph.color }} />
      </span>
    );
  return (
    <motion.span
      aria-hidden
      initial={{ scale: 0.3 }}
      animate={{ scale: 1 }}
      transition={SPRING_PRESS}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full",
        glyph.kind === "check" ? "bg-emerald-500" : "bg-red-500",
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-2.5"
        fill="none"
        stroke="white"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <motion.path
          d={glyph.kind === "check" ? CHECK_PATH : CROSS_PATH}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, ease: EASE_OUT, delay: 0.12 }}
        />
      </svg>
    </motion.span>
  );
}

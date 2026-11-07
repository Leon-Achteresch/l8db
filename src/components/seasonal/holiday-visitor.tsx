import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { HolidayGlyph } from "@/components/seasonal/holiday-glyph";
import type { SpiderVisit } from "@/lib/seasonal";
import { HOLIDAY_BY_ID, type HolidayId } from "@/lib/seasonal-calendar";

export function HolidayVisitor({
  visit,
  holiday,
  onDone,
}: {
  visit: SpiderVisit;
  holiday: HolidayId;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const exiting = leaving || visit.leaving;
  const info = HOLIDAY_BY_ID[holiday];
  useEffect(() => {
    const timer = window.setTimeout(
      exiting ? onDone : () => setLeaving(true),
      exiting ? 400 : 7200,
    );
    return () => window.clearTimeout(timer);
  }, [exiting, onDone]);
  const width = Math.min(304, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, visit.x - width + 36));
  const top = Math.max(12, Math.min(window.innerHeight - 132, visit.y));
  return (
    <motion.div
      data-seasonal="visitor"
      data-holiday={holiday}
      className="pointer-events-none fixed z-40 flex items-end gap-2"
      style={{ left, top, width }}
      initial={{ opacity: 0, y: reduced ? 0 : 16 }}
      animate={{ opacity: exiting ? 0 : 1, y: exiting && !reduced ? 12 : 0 }}
      transition={{ duration: reduced ? 0.15 : 0.35, ease: "easeOut" }}
    >
      <div
        role="status"
        className="relative min-w-0 flex-1 rounded-2xl rounded-br-sm border bg-popover px-3.5 py-3 text-popover-foreground shadow-lg"
      >
        <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground">
          {info.guest} · {info.name}
        </p>
        <p className="text-xs leading-relaxed">{visit.quip}</p>
      </div>
      <button
        type="button"
        aria-label={`${info.guest} verabschieden`}
        onClick={() => setLeaving(true)}
        className="pointer-events-auto shrink-0 cursor-pointer rounded-full transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HolidayGlyph holiday={holiday} className="size-16" />
      </button>
    </motion.div>
  );
}

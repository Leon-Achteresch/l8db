import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import type { BadgeExitVariant } from "./new-badge-exit-variants";

interface Props {
  variant: BadgeExitVariant;
  slow: boolean;
}

export function NewBadgeExitPreview({ variant, slow }: Props) {
  const [visible, setVisible] = useState(true);
  const duration = variant.duration * (slow ? 5 : 1);

  useEffect(() => {
    if (visible) return;
    const timer = setTimeout(() => setVisible(true), duration * 1000 + 700);
    return () => clearTimeout(timer);
  }, [visible, duration]);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{variant.title}</h3>
        <p className="text-xs text-muted-foreground">{variant.description}</p>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="grid w-full items-center gap-4 rounded-2xl border border-border/80 bg-card px-4 py-3.5 text-left shadow-sm hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span>Daten übertragen</span>
            <AnimatePresence>
              {visible && (
                <motion.span
                  className="inline-flex"
                  style={{ transformOrigin: variant.origin }}
                  exit={{ ...variant.exit, opacity: [1, 1, 0] }}
                  transition={{
                    duration,
                    times: variant.times,
                    ease: variant.ease,
                    opacity: { duration, times: [0, variant.fadeFrom, 1], ease: "linear" },
                  }}
                >
                  <NewBadge />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            Klicken, um das Badge zu verabschieden. Es kommt von selbst zurück.
          </span>
        </span>
      </button>
    </section>
  );
}

import { Brain } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { LAB_EFFORTS } from "./model-picker-data";

export function EffortCycle({
  value,
  onChange,
}: {
  value: string;
  onChange: (effort: string) => void;
}) {
  const index = Math.max(
    0,
    LAB_EFFORTS.findIndex((effort) => effort.id === value),
  );
  const next = LAB_EFFORTS[(index + 1) % LAB_EFFORTS.length];
  return (
    <motion.button
      type="button"
      layout
      aria-label={`Denkaufwand: ${LAB_EFFORTS[index].name}, wechseln zu ${next.name}`}
      whileTap={{ scale: 0.94 }}
      onClick={() => onChange(next.id)}
      className="flex h-8 items-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <motion.span
        animate={{ rotate: index * 90 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
      >
        <Brain className="size-3.5" />
      </motion.span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="whitespace-nowrap"
        >
          {LAB_EFFORTS[index].name}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

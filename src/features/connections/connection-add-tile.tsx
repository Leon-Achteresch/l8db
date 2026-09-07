import { Plus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease";

interface Props {
  onAdd: () => void;
}

export function ConnectionAddTile({ onAdd }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      data-tour="connection-add"
      onClick={onAdd}
      layout
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reduce ? undefined : { y: -1 }}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      transition={{ ...SPRING_PRESS, layout: SPRING_LAYOUT }}
      className="flex min-h-[13.5rem] flex-col items-start justify-between rounded-2xl border border-dashed border-border bg-transparent px-4 py-4 text-left hover:border-foreground/25 hover:bg-card"
    >
      <span className="grid size-10 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
        <Plus className="size-4" />
      </span>
      <span>
        <span className="block text-lg font-semibold tracking-tight">Neu</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Engine wählen und verbinden
        </span>
      </span>
    </motion.button>
  );
}

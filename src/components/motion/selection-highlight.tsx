import { motion, useReducedMotion } from "motion/react";

export function SelectionHighlight({ id, className }: { id: string; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      data-motion-highlight
      layoutId={id}
      initial={false}
      transition={
        reduced ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 34, mass: 0.85 }
      }
      className={className}
    />
  );
}

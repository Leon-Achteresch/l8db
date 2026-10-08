import { motion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";

interface OnboardingChoiceProps {
  group: string;
  index: number;
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  children: ReactNode;
}

export function OnboardingChoice({
  group,
  index,
  selected,
  onSelect,
  title,
  description,
  children,
}: OnboardingChoiceProps) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      initial={{ opacity: 0, y: 18 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, delay: 0.1 + index * 0.07, ease: EASE_OUT },
      }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
    >
      {selected && (
        <motion.span
          layoutId={`onboarding-choice-${group}`}
          className="pointer-events-none absolute -inset-px rounded-xl border-2 border-primary shadow-[0_0_24px_-6px_var(--color-primary)]"
          transition={SPRING_LAYOUT}
        />
      )}
      {children}
      <div className="px-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{description}</p>
      </div>
    </motion.button>
  );
}

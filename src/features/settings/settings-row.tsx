import type { ReactNode } from "react";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "@/lib/ease";

interface Props {
  title: string;
  description: string;
  children?: ReactNode;
}

export function SettingsRow({ title, description, children }: Props) {
  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="grid items-center gap-4 rounded-2xl border border-border/80 bg-card px-4 py-3.5 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children ? <div className="flex shrink-0 justify-end">{children}</div> : null}
    </motion.div>
  );
}

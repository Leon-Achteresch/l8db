import { motion } from "motion/react";
import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { NewFeatureId } from "@/lib/new-features";

interface Props {
  title: string;
  description: string;
  children?: ReactNode;
  featureId?: NewFeatureId;
}

export function SettingsRow({ title, description, children, featureId }: Props) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>(featureId);

  return (
    <motion.div
      ref={ref}
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="grid items-center gap-x-8 gap-y-3 border-b border-border/60 pb-[calc(1rem+var(--ui-density-step))] @min-[38rem]:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span>{title}</span>
          {isNew ? <NewBadge /> : null}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children ? <div className="flex shrink-0 justify-end">{children}</div> : null}
    </motion.div>
  );
}

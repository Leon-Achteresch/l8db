import { motion, useReducedMotion } from "motion/react";
import { ProviderLogo } from "@/components/provider-logo";
import type { ProviderInfo } from "@/lib/db";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props {
  provider: ProviderInfo;
  selected: boolean;
  onSelect: () => void;
}

export function ProviderTile({ provider, selected, onSelect }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      layout="position"
      whileHover={reduce ? undefined : { scale: 1.03 }}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={{ ...SPRING_PRESS, layout: SPRING_LAYOUT }}
      onClick={onSelect}
      aria-pressed={selected}
      disabled={!provider.driver_status.available}
      className={cn(
        "group relative flex h-[5.25rem] flex-col items-start justify-between overflow-hidden rounded-[1.15rem] border bg-card/90 p-2.5 text-left shadow-[inset_0_1px_0_oklch(1_0_0/0.35)] transition-colors",
        selected
          ? "border-foreground/30 bg-muted"
          : "border-border hover:border-foreground/20 hover:bg-card",
        !provider.driver_status.available && "opacity-45",
      )}
    >
      <span className="grid size-8 place-items-center rounded-xl bg-background shadow-sm ring-1 ring-border/70">
        <ProviderLogo providerId={provider.id} kind={provider.kind} className="size-5" />
      </span>
      <span className="w-full truncate text-[11px] font-semibold leading-tight">
        {provider.name}
      </span>
      {!provider.driver_status.available && (
        <span className="absolute right-2 top-2 text-[9px] font-medium text-amber-700 dark:text-amber-300">
          Treiber
        </span>
      )}
    </motion.button>
  );
}

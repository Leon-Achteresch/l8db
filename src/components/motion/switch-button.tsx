"use client";

import { LoaderCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export interface SwitchButtonProps
  extends Omit<ComponentPropsWithoutRef<"button">, "onChange"> {
  checked?: boolean;
  loading?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function SwitchButton({
  checked = false,
  loading = false,
  onCheckedChange,
  className,
  disabled,
  onClick,
  ...rest
}: SwitchButtonProps) {
  const reduce = useReducedMotion();
  const isDisabled = disabled || loading;

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading}
      disabled={isDisabled}
      whileTap={reduce || isDisabled ? undefined : { scale: 0.92 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !isDisabled) onCheckedChange?.(!checked);
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent outline-none transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input dark:bg-input/80",
        className,
      )}
      {...rest}
    >
      <motion.span
        animate={{ x: checked ? 17 : 2 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
        className="pointer-events-none grid size-4 place-items-center rounded-full bg-background shadow-sm dark:bg-foreground"
      >
        {loading ? <LoaderCircle className="size-2.5 animate-spin text-primary" /> : null}
      </motion.span>
    </motion.button>
  );
}

"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { SIZE_CLASS, VARIANT_CLASS } from "./action-swap/constants";
import { ActionSwapIcon } from "./action-swap/icon";
import { ActionSwapText } from "./action-swap/text";
import type { ActionSwapButtonProps } from "./action-swap/types";

export { ActionSwapIcon } from "./action-swap/icon";
export { ActionSwapText } from "./action-swap/text";
export type {
  ActionSwapAnimation,
  ActionSwapButtonProps,
  ActionSwapButtonSize,
  ActionSwapButtonVariant,
  ActionSwapIconProps,
  ActionSwapItem,
  ActionSwapTextProps,
} from "./action-swap/types";

export function ActionSwapButton({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = "secondary",
  size = "md",
  animation = "blur",
  iconOnly = size === "icon",
  cycle = true,
  className,
  disabled,
  onClick,
  ...rest
}: ActionSwapButtonProps) {
  const reduce = useReducedMotion();
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.id);
  const currentValue = value ?? internalValue;
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === currentValue),
  );
  const activeItem = items[activeIndex] ?? items[0];
  const hasIcon = items.some((item) => item.icon);
  const nextItem = cycle && items.length > 0 ? items[(activeIndex + 1) % items.length] : undefined;

  if (!activeItem) return null;

  const accessibleLabel =
    activeItem.ariaLabel ??
    (iconOnly && typeof activeItem.label === "string" ? activeItem.label : undefined);

  return (
    <motion.button
      type="button"
      layout
      disabled={disabled}
      whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
      transition={SPRING_PRESS}
      className={cn(
        "inline-flex items-center justify-center overflow-hidden font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      aria-label={accessibleLabel}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled || !cycle || !nextItem) return;
        if (value === undefined) setInternalValue(nextItem.id);
        onValueChange?.(nextItem.id, nextItem);
      }}
      {...rest}
    >
      {hasIcon ? (
        <ActionSwapIcon value={activeItem.id} animation={animation} className="h-4 w-4">
          {activeItem.icon ?? null}
        </ActionSwapIcon>
      ) : null}
      {!iconOnly ? (
        <ActionSwapText value={activeItem.id} animation={animation}>
          {activeItem.label}
        </ActionSwapText>
      ) : null}
    </motion.button>
  );
}

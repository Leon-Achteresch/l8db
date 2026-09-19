"use client";
// beui.dev/components/motion/action-swap

import { ActionSwapButton, type ActionSwapButtonProps } from "./action-swap";

export type {
  ActionSwapButtonSize,
  ActionSwapButtonVariant,
  ActionSwapItem,
} from "./action-swap";
export { ActionSwapCascadeIcon, type ActionSwapCascadeIconProps } from "./action-swap-cascade/icon";
export { ActionSwapCascadeText, type ActionSwapCascadeTextProps } from "./action-swap-cascade/text";

export type ActionSwapCascadeButtonProps = Omit<ActionSwapButtonProps, "animation">;

export function ActionSwapCascadeButton(props: ActionSwapCascadeButtonProps) {
  return <ActionSwapButton {...props} animation="cascade" />;
}

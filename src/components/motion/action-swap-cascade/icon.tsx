"use client";

import { ActionSwapIcon, type ActionSwapIconProps } from "../action-swap";

export type ActionSwapCascadeIconProps = Omit<ActionSwapIconProps, "animation">;

export function ActionSwapCascadeIcon(props: ActionSwapCascadeIconProps) {
  return <ActionSwapIcon {...props} animation="cascade" />;
}

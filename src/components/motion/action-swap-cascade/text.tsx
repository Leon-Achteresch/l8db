"use client";

import { ActionSwapText, type ActionSwapTextProps } from "../action-swap";

export type ActionSwapCascadeTextProps = Omit<ActionSwapTextProps, "animation">;

export function ActionSwapCascadeText(props: ActionSwapCascadeTextProps) {
  return <ActionSwapText {...props} animation="cascade" />;
}

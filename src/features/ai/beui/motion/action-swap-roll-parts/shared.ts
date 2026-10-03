import type {
  ActionSwapButtonProps,
  ActionSwapIconProps,
  ActionSwapTextProps,
} from "../action-swap";

export type { ActionSwapButtonSize, ActionSwapButtonVariant, ActionSwapItem } from "../action-swap";
export type ActionSwapRollButtonProps = Omit<ActionSwapButtonProps, "animation">;
export type ActionSwapRollTextProps = Omit<ActionSwapTextProps, "animation">;
export type ActionSwapRollIconProps = Omit<ActionSwapIconProps, "animation">;

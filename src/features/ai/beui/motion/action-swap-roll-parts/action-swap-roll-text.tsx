import { ActionSwapText } from "../action-swap";
import type { ActionSwapRollTextProps } from "./shared";

export function ActionSwapRollText(props: ActionSwapRollTextProps) {
  return <ActionSwapText {...props} animation="roll" />;
}

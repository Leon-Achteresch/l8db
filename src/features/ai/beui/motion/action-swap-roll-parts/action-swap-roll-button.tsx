import { ActionSwapButton } from "../action-swap";
import type { ActionSwapRollButtonProps } from "./shared";

export function ActionSwapRollButton(props: ActionSwapRollButtonProps) {
  return <ActionSwapButton {...props} animation="roll" />;
}

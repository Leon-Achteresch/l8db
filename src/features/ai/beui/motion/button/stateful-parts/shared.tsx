import type { Variants } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT, SPRING_SWAP } from "@/features/ai/beui/lib/ease";
import type { ButtonProps } from "../base";
export type ButtonState = "idle" | "loading" | "success" | "error";
export interface StatefulButtonProps extends Omit<ButtonProps, "children"> {
  state?: ButtonState;
  children: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  icon?: ReactNode;
}
export const CASCADE_STAGGER = 0.025;
export const ROLL_BLUR = "blur(6px)";
export const CASCADE_LETTER_VARIANTS: Variants = {
  initial: { opacity: 0, y: "105%", filter: ROLL_BLUR },
  animate: (delay: number = 0) => ({
    opacity: 1,
    y: "0%",
    filter: "blur(0px)",
    transition: { ...SPRING_SWAP, delay },
  }),
  exit: (delay: number = 0) => ({
    opacity: 0,
    y: "-105%",
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT, delay: delay * 0.5 },
  }),
};
export const ICON_VARIANTS: Variants = {
  initial: { opacity: 0, width: 0, scale: 0.7, filter: ROLL_BLUR },
  animate: {
    opacity: 1,
    width: "1.5rem",
    scale: 1,
    filter: "blur(0px)",
    transition: SPRING_SWAP,
  },
  exit: {
    opacity: 0,
    width: 0,
    scale: 0.7,
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT },
  },
};

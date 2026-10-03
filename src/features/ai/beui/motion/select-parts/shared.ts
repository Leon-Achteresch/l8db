import type { Transition, Variants } from "motion/react";
import { createContext, type ReactNode, useContext } from "react";
export const INSTANT_TRANSITION: Transition = { duration: 0 };
export const CHEVRON_TRANSITION: Transition = { type: "spring", duration: 0.4, bounce: 0.3 };
export const LIST_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};
export const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -6, filter: "blur(3px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};
export type Placement = "bottom" | "top";
export interface SelectContextValue {
  value: string | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  select: (value: string) => void;
  register: (value: string, label: string) => void;
  unregister: (value: string) => void;
  labelFor: (value: string | undefined) => string | undefined;
  reduce: boolean;
  triggerId: string;
  listId: string;
  disabled: boolean;
  placement: Placement;
  setPlacement: (p: Placement) => void;
}
export const SelectContext = createContext<SelectContextValue | null>(null);
export function useSelectContext(component: string) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error(`${component} must be used within <Select>`);
  return ctx;
}
export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}
export interface SelectTriggerProps {
  className?: string;
  children: ReactNode;
}
export interface SelectValueProps {
  placeholder?: string;
  className?: string;
}
export interface SelectContentProps {
  className?: string;
  children: ReactNode;
}
export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

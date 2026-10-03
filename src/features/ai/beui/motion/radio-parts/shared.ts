import { createContext, type ReactNode, useContext } from "react";
export type RadioCtx = {
  value: string;
  setValue: (value: string) => void;
  layoutId: string;
};
export const RadioCtx = createContext<RadioCtx | null>(null);
export function useRadioGroup() {
  const ctx = useContext(RadioCtx);
  if (!ctx) {
    throw new Error("RadioGroupItem must be used inside <RadioGroup>");
  }
  return ctx;
}
export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
  orientation?: "vertical" | "horizontal";
}
export interface RadioGroupItemProps {
  value: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

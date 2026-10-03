import { createContext, type ReactElement, type ReactNode, type Ref, useContext } from "react";
import { EASE_OUT } from "@/features/ai/beui/lib/ease";
export type Side = "top" | "bottom";
export type Align = "start" | "end";
export type MorphContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
  registerTrigger: (node: HTMLElement | null) => void;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
};
export const MorphContext = createContext<MorphContextValue | null>(null);
export function useMorphContext(component: string) {
  const ctx = useContext(MorphContext);
  if (!ctx) throw new Error(`${component} must be used within <MorphPopover>`);
  return ctx;
}
export interface MorphPopoverProps {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}
export interface MorphPopoverTriggerProps {
  children: ReactElement;
}
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object")
        (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}
export const originFor = (side: Side, align: Align) =>
  `${side === "bottom" ? "top" : "bottom"} ${align === "end" ? "right" : "left"}`;
export function clipAt(side: Side, align: Align, radius: number, inset: number) {
  const top = side === "bottom" ? "0%" : `${inset}%`;
  const bottom = side === "bottom" ? `${inset}%` : "0%";
  const right = align === "end" ? "0%" : `${inset}%`;
  const left = align === "end" ? `${inset}%` : "0%";
  return `inset(${top} ${right} ${bottom} ${left} round ${radius}px)`;
}
export const MORPH_CLIP_TRANSITION = { duration: 0.32, ease: EASE_OUT } as const;
export interface MorphPopoverContentProps {
  children: ReactNode;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  radius?: number;
  className?: string;
}

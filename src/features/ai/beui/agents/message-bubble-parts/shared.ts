import type { HTMLMotionProps } from "motion/react";
import {
  type ComponentPropsWithRef,
  createContext,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { EASE_OUT } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
export type MessageBubbleVariant = "solid" | "soft" | "tint" | "outline" | "ghost" | "danger";
export type MessageBubbleAlign = "start" | "end";
export interface MessageBubbleContextValue {
  align?: MessageBubbleAlign;
  animateIn: boolean;
  variant: MessageBubbleVariant;
}
export const MessageBubbleContext = createContext<MessageBubbleContextValue>({
  animateIn: true,
  variant: "soft",
});
export const MessageBubbleLayoutContext = createContext<() => void>(() => {});
export interface MessageBubbleProps extends Omit<HTMLMotionProps<"div">, "children"> {
  variant?: MessageBubbleVariant;
  align?: MessageBubbleAlign;
  animateIn?: boolean;
  children?: ReactNode;
}
export interface MessageBubbleContentProps extends ComponentPropsWithRef<"div"> {
  render?: ReactElement;
}
export interface MessageBubbleGroupProps extends ComponentPropsWithRef<"div"> {
  spacing?: "compact" | "default";
}
export interface MessageBubbleCollapsibleProps extends ComponentPropsWithRef<"div"> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapsedLines?: 2 | 3 | 4 | 5 | 6;
  moreLabel?: ReactNode;
  lessLabel?: ReactNode;
  contentClassName?: string;
  triggerClassName?: string;
  children?: ReactNode;
}
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }
  };
}
export const BUBBLE_CONTENT_REVEAL = {
  duration: 0.12,
  ease: EASE_OUT,
  delay: 0.04,
} as const;
export const BUBBLE_POP = {
  type: "spring",
  stiffness: 520,
  damping: 27,
  mass: 0.52,
} as const;
export function bubbleContentClass(variant: MessageBubbleVariant, interactive: boolean) {
  return cn(
    "relative z-0 min-w-9 max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 text-foreground",
    "[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-background/60 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
    variant === "solid" && "text-background",
    variant === "ghost" && "w-full max-w-none rounded-none px-0 py-0",
    variant === "danger" && "text-destructive",
    interactive &&
      "cursor-pointer text-left outline-none transition-[background-color,color,transform] duration-150 hover:brightness-[0.98] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
  );
}
export function bubbleSurfaceClass(variant: MessageBubbleVariant, align: MessageBubbleAlign) {
  return cn(
    "pointer-events-none absolute inset-0 -z-10 rounded-[inherit]",
    align === "end" ? "origin-bottom-right" : "origin-bottom-left",
    variant === "solid" && "bg-foreground",
    variant === "soft" && "bg-muted",
    variant === "tint" && "bg-muted",
    variant === "outline" && "border border-border/70 bg-background",
    variant === "danger" && "bg-destructive/10",
  );
}
export const LINE_CLAMP_CLASS = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
} as const;

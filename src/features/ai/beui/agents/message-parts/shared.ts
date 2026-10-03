import type { motion } from "motion/react";
import { type ComponentPropsWithRef, createContext, type ReactNode } from "react";

export {
  MessageBubble,
  MessageBubbleCollapsible,
  MessageBubbleContent,
  MessageBubbleGroup,
} from "@/features/ai/beui/agents/message-bubble";
export type { MessageScrollerProps } from "@/features/ai/beui/agents/message-scroller";
export { MessageScroller } from "@/features/ai/beui/agents/message-scroller";
export type MessageFrom = "user" | "assistant";
export interface MessageContextValue {
  from: MessageFrom;
}
export const MessageContext = createContext<MessageContextValue>({
  from: "assistant",
});
export interface MessageProps
  extends Omit<ComponentPropsWithRef<typeof motion.article>, "children"> {
  from: MessageFrom;
  animateIn?: boolean;
  children: ReactNode;
}
export interface MessageGroupProps extends ComponentPropsWithRef<"div"> {
  spacing?: "compact" | "default";
}
export interface MessageAvatarProps extends ComponentPropsWithRef<"div"> {
  placeholder?: boolean;
}
export type MessageContentProps = ComponentPropsWithRef<"div">;
export type MessageHeaderProps = ComponentPropsWithRef<"div">;
export type MessageFooterProps = ComponentPropsWithRef<"div">;
export type MessageMarkerProps = ComponentPropsWithRef<"div">;
export interface MessageTypingProps extends ComponentPropsWithRef<"span"> {
  label?: string;
}
export const MESSAGE_POP_UP = {
  type: "spring",
  stiffness: 480,
  damping: 32,
  mass: 0.62,
} as const;

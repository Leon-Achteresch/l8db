import { motion, useReducedMotion } from "motion/react";
import { useContext } from "react";
import { MessageSideContext } from "@/features/ai/beui/agents/message-context";
import { SPRING_LAYOUT } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import { MessageBubbleContext, type MessageBubbleProps } from "./shared";

export function MessageBubble({
  variant = "soft",
  align,
  animateIn = false,
  className,
  children,
  initial,
  animate,
  exit,
  transition,
  layout,
  ...props
}: MessageBubbleProps) {
  const reduce = useReducedMotion() ?? false;
  const messageSide = useContext(MessageSideContext);
  const resolvedAlign = align ?? messageSide ?? "start";
  return (
    <MessageBubbleContext.Provider value={{ align: resolvedAlign, animateIn, variant }}>
      <motion.div
        data-slot="message-bubble"
        data-align={resolvedAlign}
        data-variant={variant}
        layout={layout}
        initial={initial ?? false}
        animate={animate}
        exit={exit ?? (reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.99 })}
        transition={transition ?? (reduce ? { duration: 0.12 } : SPRING_LAYOUT)}
        className={cn(
          "group/bubble flex w-full flex-col",
          resolvedAlign === "end" ? "items-end" : "items-start",
          className,
        )}
        {...props}
      >
        {children}
      </motion.div>
    </MessageBubbleContext.Provider>
  );
}

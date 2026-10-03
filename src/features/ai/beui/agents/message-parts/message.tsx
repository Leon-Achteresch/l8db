import { motion, useReducedMotion } from "motion/react";
import { MessageSideContext } from "@/features/ai/beui/agents/message-context";
import { cn } from "@/lib/utils";
import { MESSAGE_POP_UP, MessageContext, type MessageProps } from "./shared";

export function Message({
  from,
  animateIn = false,
  children,
  className,
  initial,
  animate,
  transition,
  exit,
  style,
  ...props
}: MessageProps) {
  const reduce = useReducedMotion() ?? false;
  return (
    <MessageSideContext.Provider value={from === "user" ? "end" : "start"}>
      <MessageContext.Provider value={{ from }}>
        <motion.article
          data-slot="message"
          data-from={from}
          aria-label={props["aria-label"] ?? `${from} message`}
          initial={
            initial ??
            (animateIn && !reduce
              ? {
                  opacity: 0,
                  transform: "translateY(8px) scale(0.95)",
                }
              : false)
          }
          animate={
            animate ??
            (animateIn && !reduce
              ? {
                  opacity: 1,
                  transform: "translateY(0px) scale(1)",
                }
              : { opacity: 1 })
          }
          exit={
            exit ??
            (reduce
              ? { opacity: 0 }
              : {
                  opacity: 0,
                  transform: "translateY(-3px) scale(0.99)",
                })
          }
          transition={transition ?? (reduce ? { duration: 0.12 } : MESSAGE_POP_UP)}
          style={{
            transformOrigin: from === "user" ? "100% 100%" : "0% 100%",
            ...style,
          }}
          className={cn(
            "group/message flex w-full items-start gap-2",
            from === "user" ? "flex-row-reverse" : "flex-row",
            className,
          )}
          {...props}
        >
          {children}
        </motion.article>
      </MessageContext.Provider>
    </MessageSideContext.Provider>
  );
}

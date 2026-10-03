import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import type { MessageTypingProps } from "./shared";

export function MessageTyping({ label = "Responding", className, ...props }: MessageTypingProps) {
  const reduce = useReducedMotion() ?? false;
  return (
    <span
      data-slot="message-typing"
      className={cn("inline-flex h-5 items-center gap-1", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          aria-hidden="true"
          className="size-1 rounded-full bg-current"
          animate={reduce ? { opacity: 0.45 } : { opacity: [0.28, 0.85, 0.28], y: [0, -2, 0] }}
          transition={{
            duration: 1.05,
            ease: EASE_OUT,
            repeat: Number.POSITIVE_INFINITY,
            delay: index * 0.14,
          }}
        />
      ))}
    </span>
  );
}

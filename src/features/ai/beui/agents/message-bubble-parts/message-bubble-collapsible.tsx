import { ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useContext, useId, useState } from "react";
import { SPRING_SWAP } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import {
  LINE_CLAMP_CLASS,
  type MessageBubbleCollapsibleProps,
  MessageBubbleLayoutContext,
} from "./shared";

export function MessageBubbleCollapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  collapsedLines = 4,
  moreLabel = "Show more",
  lessLabel = "Show less",
  contentClassName,
  triggerClassName,
  className,
  children,
  ...props
}: MessageBubbleCollapsibleProps) {
  const reduce = useReducedMotion() ?? false;
  const contentId = useId();
  const notifyLayout = useContext(MessageBubbleLayoutContext);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      notifyLayout();
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [notifyLayout, onOpenChange, open],
  );
  return (
    <div
      data-slot="message-bubble-collapsible"
      data-state={currentOpen ? "open" : "closed"}
      className={cn("w-full", className)}
      {...props}
    >
      <div
        id={contentId}
        className={cn(
          "transition-[mask-image] duration-200",
          !currentOpen && LINE_CLAMP_CLASS[collapsedLines],
          !currentOpen && "[mask-image:linear-gradient(to_bottom,#000_68%,transparent_100%)]",
          contentClassName,
        )}
      >
        {children}
      </div>
      <button
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className={cn(
          "mt-2 inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName,
        )}
      >
        <span>{currentOpen ? lessLabel : moreLabel}</span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>
    </div>
  );
}

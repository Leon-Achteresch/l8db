import { animate, motion, useMotionValue, usePresence, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { SPRING_PANEL } from "@/features/ai/beui/lib/ease";
import { usePopoverPortalPosition } from "@/features/ai/beui/motion/popover-position";
import { cn } from "@/lib/utils";
import {
  clipAt,
  MORPH_CLIP_TRANSITION,
  type MorphPopoverContentProps,
  originFor,
  useMorphContext,
} from "./shared";

export function MorphPopoverSurface({
  children,
  side = "bottom",
  align = "end",
  sideOffset = 8,
  radius = 16,
  className,
}: MorphPopoverContentProps) {
  const ctx = useMorphContext("MorphPopoverContent");
  const reduce = useReducedMotion() ?? false;
  const [isPresent, safeToRemove] = usePresence();
  const layout = usePopoverPortalPosition(ctx.triggerRef, ctx.contentRef, isPresent);
  const left = layout
    ? align === "end"
      ? layout.trigger.left + layout.trigger.width - layout.content.width
      : layout.trigger.left
    : 0;
  const top = layout
    ? side === "bottom"
      ? layout.trigger.top + layout.trigger.height + sideOffset
      : layout.trigger.top - layout.content.height - sideOffset
    : 0;
  const wrap = reduce
    ? undefined
    : {
        hidden: { scale: 0.96, transition: SPRING_PANEL },
        show: { scale: 1, transition: SPRING_PANEL },
      };
  const clip = reduce
    ? undefined
    : {
        hidden: {
          clipPath: clipAt(side, align, radius, 92),
          transition: MORPH_CLIP_TRANSITION,
        },
        show: {
          clipPath: clipAt(side, align, radius, 0),
          transition: MORPH_CLIP_TRANSITION,
        },
      };
  const opacity = useMotionValue(0);
  const ready = layout !== null;
  useEffect(() => {
    if (!ready) {
      if (!isPresent) safeToRemove?.();
      return;
    }
    const animation = animate(opacity, isPresent ? 1 : 0, {
      ...(reduce ? { duration: 0.12 } : SPRING_PANEL),
      onComplete: () => {
        if (!isPresent) safeToRemove?.();
      },
    });
    return () => animation.stop();
  }, [opacity, ready, isPresent, reduce, safeToRemove]);
  return (
    <motion.div
      data-morph-popover-portal=""
      inert={!isPresent}
      variants={wrap}
      initial="hidden"
      animate={layout ? "show" : "hidden"}
      exit="hidden"
      style={{
        left,
        top,
        opacity,
        pointerEvents: isPresent ? "auto" : "none",
        visibility: layout ? "visible" : "hidden",
        transformOrigin: originFor(side, align),
      }}
      className="fixed z-[9999] [filter:drop-shadow(0_10px_18px_rgba(0,0,0,0.14))]"
    >
      <motion.div
        ref={ctx.contentRef}
        id={ctx.contentId}
        role="dialog"
        aria-labelledby={ctx.triggerId}
        variants={clip}
        style={{ borderRadius: radius }}
        className={cn("overflow-hidden border border-border bg-background", className)}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

import { motion, useReducedMotion } from "motion/react";
import {
  cloneElement,
  type ReactElement,
  type Ref,
  useCallback,
  useContext,
  useState,
} from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import {
  BUBBLE_CONTENT_REVEAL,
  BUBBLE_POP,
  bubbleContentClass,
  bubbleSurfaceClass,
  type MessageBubbleContentProps,
  MessageBubbleContext,
  MessageBubbleLayoutContext,
  mergeRefs,
} from "./shared";

export function MessageBubbleContent({
  render,
  className,
  children,
  ref,
  ...props
}: MessageBubbleContentProps) {
  const reduce = useReducedMotion() ?? false;
  const { align = "start", animateIn, variant } = useContext(MessageBubbleContext);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const notifyLayout = useCallback(() => setLayoutVersion((version) => version + 1), []);
  const interactive = render?.type === "button" || render?.type === "a";
  const classes = cn(bubbleContentClass(variant, interactive), className);
  const composedChildren = (
    <>
      {variant !== "ghost" ? (
        <motion.span
          aria-hidden="true"
          layout={reduce ? false : "size"}
          layoutDependency={layoutVersion}
          initial={
            animateIn && !reduce
              ? {
                  opacity: 0,
                  scale: 0.92,
                }
              : false
          }
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  opacity: { duration: 0.12, ease: EASE_OUT },
                  scale: BUBBLE_POP,
                  layout: SPRING_LAYOUT,
                }
          }
          className={bubbleSurfaceClass(variant, align)}
        />
      ) : null}
      <MessageBubbleLayoutContext.Provider value={notifyLayout}>
        <motion.div
          initial={animateIn ? (reduce ? { opacity: 0 } : { opacity: 0 }) : false}
          animate={{ opacity: 1 }}
          transition={reduce ? { duration: 0.12, ease: EASE_OUT } : BUBBLE_CONTENT_REVEAL}
          className="relative"
        >
          {children}
        </motion.div>
      </MessageBubbleLayoutContext.Provider>
    </>
  );
  if (render) {
    const child = render as ReactElement<
      Record<string, unknown> & {
        className?: string;
        ref?: Ref<HTMLElement>;
      }
    >;
    return cloneElement(child, {
      ...props,
      ref: mergeRefs(child.props.ref, ref as Ref<HTMLElement> | undefined),
      className: cn(classes, child.props.className),
      children: composedChildren,
      "data-slot": "message-bubble-content",
    });
  }
  return (
    <div ref={ref} data-slot="message-bubble-content" className={classes} {...props}>
      {composedChildren}
    </div>
  );
}

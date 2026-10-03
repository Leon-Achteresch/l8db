import { motion, useReducedMotion } from "motion/react";
import { forwardRef } from "react";
import { SPRING_PRESS } from "@/features/ai/beui/lib/ease";
import { useHoverCapable } from "@/features/ai/beui/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";
import { type ButtonLinkProps, SIZE_CLASS, VARIANT_CLASS } from "./base";
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", pressScale = 0.93, className, children, ...rest },
  ref,
) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  return (
    <motion.a
      ref={ref}
      whileTap={reduce ? undefined : { scale: pressScale }}
      whileHover={reduce || !canHover ? undefined : { scale: 1.02 }}
      transition={SPRING_PRESS}
      className={cn(
        "inline-flex items-center justify-center font-medium select-none",
        "transition-colors",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </motion.a>
  );
});

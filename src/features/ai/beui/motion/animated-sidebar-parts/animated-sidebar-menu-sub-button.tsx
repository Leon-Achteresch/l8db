import { motion } from "motion/react";
import { SPRING_PRESS } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import { type AnimatedSidebarMenuSubButtonProps, useAnimatedSidebar } from "./shared";

export function AnimatedSidebarMenuSubButton({
  children,
  icon,
  href,
  isActive = false,
  disabled = false,
  closeOnSelect = true,
  target,
  rel,
  onSelect,
  className,
}: AnimatedSidebarMenuSubButtonProps) {
  const context = useAnimatedSidebar();
  const select = (event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onSelect?.();
    if (context.isMobile && closeOnSelect) context.setOpenMobile(false);
  };
  const content = (
    <>
      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
        {icon ?? <span className="size-1 rounded-full bg-current" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );
  const interactiveClassName = cn(
    "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs outline-none",
    "text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
    "focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
    isActive && "bg-muted/70 text-foreground",
    disabled && "cursor-not-allowed opacity-40",
    className,
  );
  return href ? (
    <motion.a
      href={href}
      target={target}
      rel={rel ?? (target === "_blank" ? "noreferrer noopener" : undefined)}
      aria-current={isActive ? "page" : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </motion.a>
  ) : (
    <motion.button
      type="button"
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
      onClick={select}
      whileTap={context.reduce || disabled ? undefined : { scale: 0.98 }}
      transition={SPRING_PRESS}
      className={interactiveClassName}
    >
      {content}
    </motion.button>
  );
}

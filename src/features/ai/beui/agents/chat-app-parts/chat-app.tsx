import { AnimatedSidebarProvider } from "@/features/ai/beui/motion/animated-sidebar";
import { cn } from "@/lib/utils";
import { type ChatAppProps, MIN_DOCKED_WIDTH } from "./shared";
import { ShellFit } from "./shell-fit";

export function ChatApp({
  children,
  className,
  sidebarWidth = "17rem",
  collapseSidebarBelow = MIN_DOCKED_WIDTH,
  style,
  ...props
}: ChatAppProps) {
  return (
    <AnimatedSidebarProvider
      {...props}
      style={{ ...style, "--sidebar-width": sidebarWidth }}
      className={cn(
        "min-h-0 w-full overflow-hidden rounded-2xl border border-border bg-background",
        className,
      )}
    >
      {props.open === undefined ? <ShellFit minWidth={collapseSidebarBelow} /> : null}
      {children}
    </AnimatedSidebarProvider>
  );
}

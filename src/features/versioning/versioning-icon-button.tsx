import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function VersioningIconButton({
  icon: Icon,
  label,
  className,
  ...props
}: ComponentProps<"button"> & { icon: LucideIcon; label: string }) {
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-muted aria-pressed:text-foreground [&_svg]:size-4",
              className,
            )}
            {...props}
          >
            <Icon strokeWidth={1.7} />
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

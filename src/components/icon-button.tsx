import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function IconButton({
  "aria-label": label,
  disabledReason,
  ...props
}: ComponentProps<typeof Button> & { "aria-label": string }) {
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>
          {props.disabled ? (
            <span className="inline-flex">
              <Button {...props} aria-label={label} />
            </span>
          ) : (
            <Button {...props} aria-label={label} />
          )}
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {props.disabled && disabledReason ? disabledReason : label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

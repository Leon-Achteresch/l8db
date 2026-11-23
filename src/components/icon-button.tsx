import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function IconButton({
  "aria-label": label,
  disabledReason,
  title,
  ...props
}: ComponentProps<typeof Button> & { "aria-label": string; "data-hotkey"?: string }) {
  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        {props.disabled ? (
          <span className="inline-flex">
            <Button {...props} aria-label={label} />
          </span>
        ) : (
          <Button {...props} aria-label={label} />
        )}
      </TooltipTrigger>
      <TooltipContent sideOffset={6} hotkey={props.disabled ? undefined : props["data-hotkey"]}>
        {props.disabled && disabledReason ? disabledReason : (title ?? label)}
      </TooltipContent>
    </Tooltip>
  );
}

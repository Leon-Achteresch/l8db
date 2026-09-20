import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useVersioningPanel } from "@/lib/versioning/panel";
import { VersioningIconButton } from "./versioning-icon-button";

export function VersioningPopover({
  icon,
  label,
  children,
  trigger,
  disabled,
  className,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  trigger?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelOpen = useVersioningPanel((state) => state.open);
  useEffect(() => {
    if (!panelOpen) setOpen(false);
  }, [panelOpen]);
  return (
    <Popover open={open && panelOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? <VersioningIconButton icon={icon} label={label} disabled={disabled} />}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label={label}
        className={cn(
          "vcs-surface w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-xl p-4 shadow-lg shadow-black/5 ring-border/50",
          className,
        )}
      >
        <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-semibold">{label}</h3>
          {children}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

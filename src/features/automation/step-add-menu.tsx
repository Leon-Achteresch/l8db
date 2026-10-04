import { TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ACTION_TYPES,
  STEP_CATALOG,
  STEP_GROUP_TONE,
  STEP_GROUPS,
} from "@/lib/automation/step-catalog";
import type { ActionType } from "@/lib/db/automation";
import { cn } from "@/lib/utils";

interface Props {
  onPick: (type: ActionType) => void;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "right";
}

export function StepAddMenu({ onPick, children, align = "start", side = "bottom" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} side={side} sideOffset={6} className="w-[22rem] p-0">
        <Command>
          <CommandInput placeholder="Schritt suchen …" />
          <CommandList className="max-h-[min(26rem,var(--radix-popover-content-available-height,26rem))]">
            <CommandEmpty>Kein passender Schritt.</CommandEmpty>
            {STEP_GROUPS.map((group) => (
              <CommandGroup key={group} heading={group}>
                {ACTION_TYPES.filter((type) => STEP_CATALOG[type].group === group).map((type) => {
                  const entry = STEP_CATALOG[type];
                  const Icon = entry.icon;
                  return (
                    <CommandItem
                      key={type}
                      value={entry.label}
                      keywords={[entry.description, type]}
                      onSelect={() => {
                        setOpen(false);
                        onPick(type);
                      }}
                      className="items-start gap-2.5 py-2"
                    >
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-lg",
                          STEP_GROUP_TONE[group],
                        )}
                      >
                        <Icon className="size-3.5" style={{ color: "inherit" }} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium">
                          {entry.label}
                          {entry.risky && (
                            <TriangleAlertIcon
                              className="size-3 text-amber-600 dark:text-amber-400"
                              aria-label="Verändert Daten oder Dateien"
                            />
                          )}
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {entry.description}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

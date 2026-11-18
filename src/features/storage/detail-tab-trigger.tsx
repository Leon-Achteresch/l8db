import type { LucideIcon } from "lucide-react";
import { TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function DetailTabTrigger({
  value,
  label,
  icon: Icon,
}: {
  value: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <TabsTrigger value={value} aria-label={label} className="flex-1 px-0">
          <Icon className="size-4" />
        </TabsTrigger>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

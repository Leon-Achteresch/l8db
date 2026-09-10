import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/motion/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type SidebarObjectTab = {
  value: string;
  label: string;
  icon: LucideIcon;
};

export function SidebarObjectTabs({
  tabs,
  value,
  onValueChange,
}: {
  tabs: SidebarObjectTab[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <TabsList className="w-full">
        {tabs.map((tab) => (
          <Tooltip
            key={tab.value}
            content={tab.label}
            side="bottom"
            wrapperClassName="h-full flex-1"
          >
            <TabsTrigger value={tab.value} className="h-full w-full px-0" aria-label={tab.label}>
              <tab.icon className="size-4" />
            </TabsTrigger>
          </Tooltip>
        ))}
      </TabsList>
    </Tabs>
  );
}

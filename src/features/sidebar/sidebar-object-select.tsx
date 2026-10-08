import { NewBadge } from "@/components/new-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SidebarObjectTab } from "@/features/sidebar/sidebar-object-tabs";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";

export function SidebarObjectSelect({
  tabs,
  value,
  onValueChange,
}: {
  tabs: SidebarObjectTab[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const seen = useSeenNewFeatures();
  const activeTab = tabs.find((tab) => tab.value === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Objekttyp"
        className="h-8 min-w-0 border-none px-2 text-xs font-medium text-sidebar-foreground/70 shadow-none hover:bg-sidebar-accent hover:text-sidebar-foreground dark:bg-transparent dark:hover:bg-sidebar-accent"
      >
        <SelectValue />
        {hasNewFeatures(activeTab?.featureScope, seen) ? <NewBadge /> : null}
      </SelectTrigger>
      <SelectContent>
        {tabs.map((tab) => (
          <SelectItem key={tab.value} value={tab.value}>
            <tab.icon className="size-3.5 text-muted-foreground" />
            {tab.label}
            {hasNewFeatures(tab.featureScope, seen) ? <NewBadge /> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

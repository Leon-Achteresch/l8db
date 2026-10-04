import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SidebarObjectTab } from "@/features/sidebar/sidebar-object-tabs";

export function SidebarObjectSelect({
  tabs,
  value,
  onValueChange,
}: {
  tabs: SidebarObjectTab[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        aria-label="Objekttyp"
        className="h-8 min-w-0 border-none px-2 text-xs font-medium text-sidebar-foreground/70 shadow-none hover:bg-sidebar-accent hover:text-sidebar-foreground dark:bg-transparent dark:hover:bg-sidebar-accent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {tabs.map((tab) => (
          <SelectItem key={tab.value} value={tab.value}>
            <tab.icon className="size-3.5 text-muted-foreground" />
            {tab.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

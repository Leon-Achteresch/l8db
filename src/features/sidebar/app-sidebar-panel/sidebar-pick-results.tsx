import { ColumnsIcon, EyeIcon, TableIcon } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import type { SidebarEntityMatch } from "./use-sidebar-entity-filter";

export function SidebarPickResults({
  filtered,
  type,
  activeItem,
  onPick,
}: {
  filtered: SidebarEntityMatch[];
  type: "table" | "view";
  activeItem?: string | null;
  onPick: (schema: string, name: string) => void;
}) {
  if (filtered.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>;
  }
  const Icon = type === "view" ? EyeIcon : TableIcon;
  return (
    <SidebarWindow
      count={filtered.length}
      disabled={filtered.some((item) => Boolean(item.matchingColumns?.length))}
    >
      {(index) => {
        const item = filtered[index];
        const id = `${item.schema}.${item.name}`;
        return (
          <SidebarMenuItem key={id}>
            <SidebarMenuButton
              isActive={id === activeItem}
              onClick={() => onPick(item.schema, item.name)}
              data-schema={item.schema}
              data-name={item.name}
            >
              <Icon className="text-muted-foreground" />
              <span className="truncate">{item.name}</span>
            </SidebarMenuButton>
            {item.matchingColumns?.length ? (
              <SidebarMenuSub>
                {item.matchingColumns.map((column) => (
                  <SidebarMenuSubItem key={column}>
                    <SidebarMenuSubButton size="sm" asChild>
                      <button type="button" onClick={() => onPick(item.schema, item.name)}>
                        <ColumnsIcon className="text-muted-foreground" />
                        <span className="truncate">{column}</span>
                      </button>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        );
      }}
    </SidebarWindow>
  );
}

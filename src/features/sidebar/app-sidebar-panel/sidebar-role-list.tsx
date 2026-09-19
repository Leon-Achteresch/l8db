import { useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { useTableTabs } from "@/lib/table-tabs";

export interface SidebarRoleListProps {
  items: { name: string; can_login: boolean }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarRoleList({ items, isLoading, isError, error }: SidebarRoleListProps) {
  const navigate = useNavigate();
  const openRoleTab = useTableTabs((state) => state.openRoleTab);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Benutzer…
      </div>
    );
  }

  if (isError) {
    return <SidebarQueryError error={error} />;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Rollen gefunden.</p>;
  }

  return (
    <SidebarWindow count={items.length}>
      {(index) => (
        <SidebarMenuItem key={items[index].name}>
          <SidebarMenuButton
            onClick={() => {
              openRoleTab({ name: items[index].name });
              navigate({
                to: "/users/$name",
                params: { name: items[index].name },
              });
            }}
          >
            <UsersIcon className="text-muted-foreground" />
            <span className="truncate">
              {items[index].name}
              {items[index].can_login ? "" : " (Rolle)"}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarWindow>
  );
}

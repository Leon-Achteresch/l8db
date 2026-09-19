import { useNavigate } from "@tanstack/react-router";
import { PackageIcon, SearchIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { useTableTabs } from "@/lib/table-tabs";

export interface SidebarExtensionListProps {
  items: { name: string; version: string | null }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarExtensionList({
  items,
  isLoading,
  isError,
  error,
}: SidebarExtensionListProps) {
  const navigate = useNavigate();
  const openExtensionTab = useTableTabs((state) => state.openExtensionTab);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Packages…
      </div>
    );
  }

  if (isError) {
    return <SidebarQueryError error={error} />;
  }

  if (!items || items.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={() => navigate({ to: "/available-extensions" })}>
            <SearchIcon className="text-muted-foreground" />
            <span className="truncate">Extensions durchsuchen</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => navigate({ to: "/available-extensions" })}>
          <SearchIcon className="text-muted-foreground" />
          <span className="truncate">Extensions durchsuchen</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {items.map((item) => (
        <SidebarMenuItem key={item.name}>
          <SidebarMenuButton
            onClick={() => {
              openExtensionTab({ name: item.name });
              navigate({
                to: "/extensions/$name",
                params: { name: item.name },
              });
            }}
          >
            <PackageIcon className="text-muted-foreground" />
            <span className="truncate">
              {item.name}
              {item.version ? ` (${item.version})` : ""}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

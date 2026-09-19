import { useNavigate } from "@tanstack/react-router";
import { ListOrderedIcon } from "lucide-react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";

export interface SidebarSequenceListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarSequenceList({
  items,
  isLoading,
  isError,
  error,
}: SidebarSequenceListProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Sequenzen…
      </div>
    );
  }

  if (isError) {
    return <SidebarQueryError error={error} />;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Sequenzen gefunden.</p>;
  }

  return (
    <SidebarWindow count={items.length}>
      {(index) => (
        <SidebarMenuItem key={`${items[index].schema}.${items[index].name}`}>
          <SidebarMenuButton
            onClick={() => {
              navigate({ to: "/sequences" });
            }}
          >
            <ListOrderedIcon className="text-muted-foreground" />
            <span className="truncate">{items[index].name}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarWindow>
  );
}

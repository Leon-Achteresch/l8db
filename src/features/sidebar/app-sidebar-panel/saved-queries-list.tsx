import { useNavigate } from "@tanstack/react-router";
import { FileCodeIcon, TrashIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { useTableTabs } from "@/lib/table-tabs";

export function SavedQueriesList() {
  const queries = useSavedQueriesStore((state) => state.queries);
  const deleteQuery = useSavedQueriesStore((state) => state.deleteQuery);
  const navigate = useNavigate();
  const tabs = useTableTabs((state) => state.tabs);
  const openSavedQueryTab = useTableTabs((state) => state.openSavedQueryTab);

  if (queries.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine gespeicherten Queries.</p>;
  }

  return (
    <SidebarMenu>
      {queries.map((query) => {
        const existingTab = tabs.find((t) => t.kind === "query" && t.id === query.id);
        return (
          <SidebarMenuItem key={query.id}>
            <SidebarMenuButton
              isActive={Boolean(existingTab)}
              onClick={() => {
                if (!existingTab) {
                  openSavedQueryTab({ id: query.id, title: query.name, sql: query.sql });
                }
                navigate({ to: "/query/$id", params: { id: query.id } });
              }}
            >
              <FileCodeIcon className="text-muted-foreground" />
              <span className="truncate">{query.name}</span>
            </SidebarMenuButton>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteQuery(query.id);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover/menu-item:opacity-100"
            >
              <TrashIcon className="size-3.5" />
            </button>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

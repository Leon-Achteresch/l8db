import { useNavigate } from "@tanstack/react-router";
import { FileCodeIcon, TrashIcon } from "lucide-react";
import { useMemo } from "react";
import { FeatureEmptyState } from "@/components/feature-empty-state/feature-empty-state";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { SavedQueryOriginLabel } from "@/features/query/saved-query-origin-label";
import { useConnectionsStore } from "@/lib/connections";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { savedQueryConnectionNames, savedQueryOriginInfo } from "@/lib/saved-query-origin";
import { useTableTabs } from "@/lib/table-tabs";

export function SavedQueriesList() {
  const queries = useSavedQueriesStore((state) => state.queries);
  const connections = useConnectionsStore((state) => state.connections);
  const originNames = useMemo(() => savedQueryConnectionNames(connections), [connections]);
  const deleteQuery = useSavedQueriesStore((state) => state.deleteQuery);
  const navigate = useNavigate();
  const tabs = useTableTabs((state) => state.tabs);
  const openSavedQueryTab = useTableTabs((state) => state.openSavedQueryTab);

  if (queries.length === 0) {
    return (
      <FeatureEmptyState
        icon={FileCodeIcon}
        title="Keine gespeicherten Abfragen."
        featureId="query.snippets"
        action={{ label: "Editor öffnen", onClick: () => void navigate({ to: "/query" }) }}
        className="py-4"
      />
    );
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
              <span className="min-w-0 flex-1 truncate">{query.name}</span>
              <SavedQueryOriginLabel info={savedQueryOriginInfo(query.origin, originNames)} />
            </SidebarMenuButton>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteQuery(query.id);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive menu-item-hover:opacity-100"
            >
              <TrashIcon className="size-3.5" />
            </button>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

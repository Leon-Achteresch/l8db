import { useMatchRoute } from "@tanstack/react-router";

import { type Tab, useTableTabs } from "@/lib/table-tabs";
import { TOOL_TABS } from "@/lib/tool-tabs";

type MatchRoute = ReturnType<typeof useMatchRoute>;

export function tabMatchesRoute(matchRoute: MatchRoute, tab: Tab): boolean {
  if (tab.kind === "table") {
    return Boolean(
      matchRoute({
        to: "/tables/$schema/$table",
        params: { schema: tab.schema, table: tab.table },
        search: (tab.entityType ?? "table") === "view" ? { type: "view" } : {},
      }),
    );
  }
  if (tab.kind === "query") {
    return Boolean(matchRoute({ to: "/query/$id", params: { id: tab.id } }));
  }
  if (tab.kind === "function") {
    return Boolean(
      matchRoute({
        to: "/functions/$schema/$name",
        params: { schema: tab.schema, name: tab.name },
        search: { oid: tab.oid },
      }),
    );
  }
  if (tab.kind === "procedure") {
    return Boolean(
      matchRoute({
        to: "/procedures/$schema/$name",
        params: { schema: tab.schema, name: tab.name },
        search: { oid: tab.oid },
      }),
    );
  }
  if (tab.kind === "role") {
    return Boolean(matchRoute({ to: "/users/$name", params: { name: tab.name } }));
  }
  if (tab.kind === "trigger") {
    return Boolean(
      matchRoute({
        to: "/triggers/$schema/$table/$trigger",
        params: { schema: tab.schema, table: tab.table, trigger: tab.trigger },
      }),
    );
  }
  if (tab.kind === "view-editor") {
    return Boolean(
      matchRoute({
        to: "/view-editor/$schema/$view",
        params: { schema: tab.schema, view: tab.view },
      }),
    );
  }
  if (tab.kind === "alter-table") {
    return Boolean(
      matchRoute({
        to: "/alter-table/$schema/$table",
        params: { schema: tab.schema, table: tab.table },
      }),
    );
  }
  if (tab.kind === "package") {
    return Boolean(
      matchRoute({
        to: "/packages/$schema/$name",
        params: { schema: tab.schema, name: tab.name },
      }),
    );
  }
  if (tab.kind === "tool") {
    return Boolean(matchRoute({ to: TOOL_TABS[tab.tool].path }));
  }
  if (tab.kind === "extension-panel") {
    return Boolean(
      matchRoute({
        to: "/extension-panels/$extensionId/$panelId",
        params: { extensionId: tab.extensionId, panelId: tab.panelId },
      }),
    );
  }
  return Boolean(matchRoute({ to: "/extensions/$name", params: { name: tab.name } }));
}

export function useActiveWorkspaceTab(): Tab | undefined {
  const tabs = useTableTabs((state) => state.tabs);
  const matchRoute = useMatchRoute();
  return tabs.find((tab) => tabMatchesRoute(matchRoute, tab));
}

export function useTabRouteMatch(): (tab: Tab) => boolean {
  const matchRoute = useMatchRoute();
  return (tab) => tabMatchesRoute(matchRoute, tab);
}

import { queryTabLabel } from "@/lib/query-tab-title";
import type { Tab } from "@/lib/table-tabs";
import { TOOL_TABS } from "@/lib/tool-tabs";

type TabNavigate = (opts: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown> | (() => Record<string, unknown>);
}) => unknown;

export function navigateToTab(navigate: TabNavigate, tab: Tab): unknown {
  if (tab.kind === "table") {
    return navigate({
      to: "/tables/$schema/$table",
      params: { schema: tab.schema, table: tab.table },
      search: () => ((tab.entityType ?? "table") === "view" ? { type: "view" as const } : {}),
    });
  }
  if (tab.kind === "query") {
    return navigate({ to: "/query/$id", params: { id: tab.id } });
  }
  if (tab.kind === "function") {
    return navigate({
      to: "/functions/$schema/$name",
      params: { schema: tab.schema, name: tab.name },
      search: { oid: tab.oid },
    });
  }
  if (tab.kind === "procedure") {
    return navigate({
      to: "/procedures/$schema/$name",
      params: { schema: tab.schema, name: tab.name },
      search: { oid: tab.oid },
    });
  }
  if (tab.kind === "role") {
    return navigate({ to: "/users/$name", params: { name: tab.name } });
  }
  if (tab.kind === "trigger") {
    return navigate({
      to: "/triggers/$schema/$table/$trigger",
      params: { schema: tab.schema, table: tab.table, trigger: tab.trigger },
    });
  }
  if (tab.kind === "view-editor") {
    return navigate({
      to: "/view-editor/$schema/$view",
      params: { schema: tab.schema, view: tab.view },
    });
  }
  if (tab.kind === "alter-table") {
    return navigate({
      to: "/alter-table/$schema/$table",
      params: { schema: tab.schema, table: tab.table },
    });
  }
  if (tab.kind === "package") {
    return navigate({
      to: "/packages/$schema/$name",
      params: { schema: tab.schema, name: tab.name },
    });
  }
  if (tab.kind === "tool") {
    return navigate({ to: TOOL_TABS[tab.tool].path });
  }
  if (tab.kind === "extension-panel") {
    return navigate({
      to: "/extension-panels/$extensionId/$panelId",
      params: { extensionId: tab.extensionId, panelId: tab.panelId },
    });
  }
  return navigate({ to: "/extensions/$name", params: { name: tab.name } });
}

export function tabLabel(tab: Tab): string {
  if (tab.kind === "table") return tab.table;
  if (tab.kind === "query") return queryTabLabel(tab);
  if (tab.kind === "function") return tab.name;
  if (tab.kind === "procedure") return tab.name;
  if (tab.kind === "trigger") return tab.trigger;
  if (tab.kind === "view-editor") return tab.view;
  if (tab.kind === "alter-table") return tab.table;
  if (tab.kind === "extension-panel") return tab.title;
  if (tab.kind === "tool") return TOOL_TABS[tab.tool].label;
  return tab.name;
}

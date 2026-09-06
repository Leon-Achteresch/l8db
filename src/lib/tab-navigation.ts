import type { Tab } from "@/lib/table-tabs";

type TabNavigate = (opts: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown> | (() => Record<string, unknown>);
}) => unknown;

export function navigateToTab(navigate: TabNavigate, tab: Tab) {
  if (tab.kind === "table") {
    void navigate({
      to: "/tables/$schema/$table",
      params: { schema: tab.schema, table: tab.table },
      search: () => ((tab.entityType ?? "table") === "view" ? { type: "view" as const } : {}),
    });
    return;
  }
  if (tab.kind === "query") {
    void navigate({ to: "/query/$id", params: { id: tab.id } });
    return;
  }
  if (tab.kind === "function") {
    void navigate({
      to: "/functions/$schema/$name",
      params: { schema: tab.schema, name: tab.name },
      search: { oid: tab.oid },
    });
    return;
  }
  if (tab.kind === "role") {
    void navigate({ to: "/users/$name", params: { name: tab.name } });
    return;
  }
  if (tab.kind === "trigger") {
    void navigate({
      to: "/triggers/$schema/$table/$trigger",
      params: { schema: tab.schema, table: tab.table, trigger: tab.trigger },
    });
    return;
  }
  if (tab.kind === "view-editor") {
    void navigate({
      to: "/view-editor/$schema/$view",
      params: { schema: tab.schema, view: tab.view },
    });
    return;
  }
  if (tab.kind === "alter-table") {
    void navigate({
      to: "/alter-table/$schema/$table",
      params: { schema: tab.schema, table: tab.table },
    });
    return;
  }
  if (tab.kind === "package") {
    void navigate({
      to: "/packages/$schema/$name",
      params: { schema: tab.schema, name: tab.name },
    });
    return;
  }
  void navigate({ to: "/extensions/$name", params: { name: tab.name } });
}

export function tabLabel(tab: Tab): string {
  if (tab.kind === "table") return tab.table;
  if (tab.kind === "query") return tab.title;
  if (tab.kind === "function") return tab.name;
  if (tab.kind === "trigger") return tab.trigger;
  if (tab.kind === "view-editor") return tab.view;
  if (tab.kind === "alter-table") return tab.table;
  return tab.name;
}

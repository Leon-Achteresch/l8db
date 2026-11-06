import { type QueryTab, useTableTabs } from "@/lib/table-tabs";
import { storeFor } from "@/lib/table-tabs/helpers";

export function createQueryVariant(tabId: string, sql: string): string {
  const state = useTableTabs.getState();
  const source = state.tabs.find((tab) => tab.kind === "query" && tab.id === tabId);
  if (source?.kind !== "query")
    throw new Error("Die ursprüngliche Abfrage ist nicht mehr geöffnet.");
  const variant: QueryTab = {
    kind: "query",
    id: crypto.randomUUID(),
    title: `${source.title} – Variante`,
    sql,
    variant: { sourceId: tabId, title: source.title, sql },
  };
  useTableTabs.setState(storeFor([...state.tabs, variant], state));
  return variant.id;
}

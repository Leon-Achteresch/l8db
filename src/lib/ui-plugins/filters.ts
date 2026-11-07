import type { DatabaseKind } from "@/lib/db";
import { useExtensionPrompts } from "@/lib/extensions/prompts";
import { capabilitiesFor } from "@/lib/providers";
import { compileSingleCondition } from "@/lib/sql-filter";
import { useTableViewStateStore } from "@/lib/table-view-state";
import type { ActionContext, ColumnInfo, TableInfo } from "./api";

export function pluginFilters(
  table: TableInfo,
  columns: readonly ColumnInfo[],
  stateKey: string | null | undefined,
): Pick<ActionContext, "setFilter" | "clearFilter" | "pickColumn"> {
  const kind = table.connection.kind as DatabaseKind;
  const assertSupported = () => {
    if (!stateKey || !capabilitiesFor(kind).sql_filter)
      throw new Error("Diese Tabellenansicht unterstützt keine Plugin-Filter.");
    return stateKey;
  };
  return {
    setFilter(filter) {
      const key = assertSupported();
      const column = columns.find((entry) => entry.id === filter.column);
      if (!column) throw new Error("Die Spalte gehört nicht zu dieser Tabelle.");
      const expression = compileSingleCondition(
        column.id,
        filter.operator,
        filter.value ?? "",
        kind,
        column.type,
      );
      if (!expression) throw new Error("Ungültiger Filter oder fehlender Wert.");
      const store = useTableViewStateStore.getState();
      const current = store.views[key];
      if (current?.filterRaw)
        throw new Error("Bitte zuerst den SQL-Filter in einen einfachen Filter umwandeln.");
      const previous = current?.filter?.trim();
      const next = previous ? `(${previous}) AND (${expression})` : expression;
      if (next.length > 65536) throw new Error("Der Filter ist zu groß.");
      store.patch(key, { filter: next, filterRaw: false, page: 0 });
    },
    clearFilter() {
      const key = assertSupported();
      useTableViewStateStore.getState().patch(key, {
        filter: "",
        filterRaw: false,
        filterConditions: [],
        filterSql: "",
        page: 0,
      });
    },
    async pickColumn() {
      if (!columns.length) return null;
      const picked = await useExtensionPrompts.getState().request({
        kind: "quickPick",
        extensionId: "ui-plugin",
        title: "Spalte auswählen",
        items: columns.map((column) => ({ label: column.id })),
        canPickMany: false,
      });
      if (!picked?.length) return null;
      return columns[picked[0]]?.id ?? null;
    },
  };
}
